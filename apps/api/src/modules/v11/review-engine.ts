import { createHash } from 'node:crypto';
import { contentRatingFromScore, V11_CONTENT_DIMENSIONS, V11ContentDimension, V11ContentRating } from './content-scoring';
import type { V11FactClaimKey } from './fact-claims';

export type ReviewRun = {
  score: number;
  rating: V11ContentRating;
  anchors: Record<V11ContentDimension, number>;
  factsHash: string;
  factClaims: Array<{
    dimension: V11ContentDimension;
    key: V11FactClaimKey;
    state: 'present' | 'absent' | 'uncertain';
  }>;
  complianceStatus: 'clear' | 'suspected' | 'confirmed';
};

const ratingOrder: V11ContentRating[] = ['D', 'C', 'B-', 'B', 'A', 'A+'];
const boundaries = [60, 68, 74, 82, 90];

export function requiresIndependentReview(input: {
  eligiblePilotCount: number;
  fingerprint: string;
  score: number;
  rating: V11ContentRating;
  comparableHistoricalScore?: number | null;
  factualContradiction?: boolean;
  appeal?: boolean;
}) {
  if (input.eligiblePilotCount < 50 || input.rating === 'A+' || input.appeal || input.factualContradiction) return true;
  if (boundaries.some((boundary) => Math.abs(input.score - boundary) <= 2)) return true;
  if (input.comparableHistoricalScore !== null && input.comparableHistoricalScore !== undefined && Math.abs(input.score - input.comparableHistoricalScore) > 5) return true;
  const bucket = createHash('sha256').update(input.fingerprint).digest()[0] % 10;
  return bucket === 0;
}

function ratingDistance(left: V11ContentRating, right: V11ContentRating) {
  return Math.abs(ratingOrder.indexOf(left) - ratingOrder.indexOf(right));
}

function scoreFromAnchors(anchors: Record<V11ContentDimension, number>) {
  return Math.round(V11_CONTENT_DIMENSIONS.reduce((sum, item) => sum + item.weight * anchors[item.code] / 4, 0) * 10) / 10;
}

function majorComplianceConflict(runs: ReviewRun[]) {
  const statuses = new Set(runs.map((run) => run.complianceStatus));
  return statuses.has('clear') && statuses.has('confirmed');
}

function factsAgree(runs: ReviewRun[]) {
  return !hasExplicitFactContradiction(runs);
}

function hasExplicitFactContradiction(runs: ReviewRun[]) {
  const states = new Map<string, Set<string>>();
  for (const run of runs) {
    for (const claim of run.factClaims) {
      if (claim.state === 'uncertain') continue;
      const key = `${claim.dimension}:${claim.key}`;
      const values = states.get(key) ?? new Set<string>();
      values.add(claim.state);
      states.set(key, values);
    }
  }
  return [...states.values()].some((values) => values.has('present') && values.has('absent'));
}

export function detectFirstRunFactualContradiction(
  run: Pick<ReviewRun, 'factClaims'>,
  mediaManifest: { hasAudio?: boolean | null },
) {
  if (hasExplicitFactContradiction([run as ReviewRun])) return true;
  if (typeof mediaManifest.hasAudio !== 'boolean') return false;
  const audioClaim = run.factClaims.find((claim) => claim.dimension === 'subtitle_audio' && claim.key === 'audio_present');
  if (!audioClaim || audioClaim.state === 'uncertain') return false;
  return (mediaManifest.hasAudio && audioClaim.state === 'absent')
    || (!mediaManifest.hasAudio && audioClaim.state === 'present');
}

export function decideFirstRunReview(input: {
  run: ReviewRun;
  mediaManifest: { hasAudio?: boolean | null };
  eligiblePilotCount: number;
  fingerprint: string;
  comparableHistoricalScore?: number | null;
  appeal?: boolean;
}) {
  return requiresIndependentReview({
    eligiblePilotCount: input.eligiblePilotCount,
    fingerprint: input.fingerprint,
    score: input.run.score,
    rating: input.run.rating,
    comparableHistoricalScore: input.comparableHistoricalScore,
    appeal: input.appeal,
    factualContradiction: detectFirstRunFactualContradiction(input.run, input.mediaManifest),
  });
}

function hold(reason: string) {
  return { action: 'hold' as const, reason };
}

function adopted(anchors: Record<V11ContentDimension, number>, method: 'double_average' | 'triple_median') {
  const totalScore = scoreFromAnchors(anchors);
  return { action: 'adopt' as const, method, anchors, totalScore, contentRating: contentRatingFromScore(totalScore) };
}

export function decideReviewProgress(runs: ReviewRun[]) {
  if (runs.length < 2) return { action: 'second_review' as const };
  if (runs.length > 3) throw new Error('No more than three valid scoring runs are allowed.');
  const scores = runs.map((run) => run.score);
  if (Math.max(...scores) - Math.min(...scores) > 10) return hold('score_difference_over_ten');
  if (Math.max(...runs.flatMap((left) => runs.map((right) => ratingDistance(left.rating, right.rating)))) >= 2) return hold('rating_difference_two_levels');
  if (hasExplicitFactContradiction(runs)) return hold('major_fact_conflict');
  if (majorComplianceConflict(runs)) return hold('major_compliance_conflict');

  if (runs.length === 2) {
    const [left, right] = runs;
    const maxAnchorDifference = Math.max(...V11_CONTENT_DIMENSIONS.map((item) => Math.abs(left.anchors[item.code] - right.anchors[item.code])));
    if (left.rating === right.rating && Math.abs(left.score - right.score) <= 5 && maxAnchorDifference <= 1 && factsAgree(runs)) {
      const anchors = Object.fromEntries(V11_CONTENT_DIMENSIONS.map((item) => [item.code, (left.anchors[item.code] + right.anchors[item.code]) / 2])) as Record<V11ContentDimension, number>;
      return adopted(anchors, 'double_average');
    }
    return { action: 'third_review' as const, reason: maxAnchorDifference >= 2 ? 'anchor_difference' : 'unstable_double_review' };
  }

  const ratingCounts = new Map<V11ContentRating, number>();
  for (const run of runs) ratingCounts.set(run.rating, (ratingCounts.get(run.rating) || 0) + 1);
  const majority = [...ratingCounts.entries()].find(([, count]) => count >= 2)?.[0];
  if (!majority) return hold('no_rating_majority');
  if (!factsAgree(runs)) return hold('facts_not_agreed_after_third');
  const anchors = {} as Record<V11ContentDimension, number>;
  for (const item of V11_CONTENT_DIMENSIONS) {
    const values = runs.map((run) => run.anchors[item.code]).sort((a, b) => a - b);
    if (values[0] !== values[1] && values[1] !== values[2]) return hold(`no_anchor_majority:${item.code}`);
    anchors[item.code] = values[1];
  }
  const result = adopted(anchors, 'triple_median');
  return result.contentRating === majority ? result : hold('backend_rating_disagrees_with_majority');
}
