export const CONTENT_SCORING_VERSION = 'content-score-v2';

export const contentDimensionCodes = [
  'hook',
  'product_exposure',
  'selling_points',
  'visual_quality',
  'composition',
  'camera_language',
  'pacing',
  'subtitle_clarity',
  'voiceover_clarity',
  'bgm_fit',
  'platform_fit',
  'purpose_fit',
] as const;

export type ContentDimensionCode = (typeof contentDimensionCodes)[number];
export type ContentGrade = 'S' | 'A' | 'B' | 'C' | 'D';
export type ContentScoreReasonCode = 'HIGH_COMPLIANCE_RISK' | 'REQUIRED_PRODUCT_NOT_VISIBLE';
export type ContentScoringVideoType =
  | 'product_card'
  | 'qianchuan_ad'
  | 'live_room_traffic'
  | 'organic'
  | 'brand_seeding'
  | 'other';

type ContentScoringProfile = {
  weights: Record<ContentDimensionCode, number>;
  requiresProductExposure: boolean;
};

const standardWeights: Record<ContentDimensionCode, number> = {
  hook: 15,
  product_exposure: 10,
  selling_points: 15,
  visual_quality: 10,
  composition: 5,
  camera_language: 5,
  pacing: 10,
  subtitle_clarity: 5,
  voiceover_clarity: 5,
  bgm_fit: 5,
  platform_fit: 7,
  purpose_fit: 8,
};

function profile(requiresProductExposure: boolean): ContentScoringProfile {
  return { weights: { ...standardWeights }, requiresProductExposure };
}

export const CONTENT_SCORING_PROFILES: Record<ContentScoringVideoType, ContentScoringProfile> = {
  product_card: profile(true),
  qianchuan_ad: profile(true),
  live_room_traffic: profile(true),
  organic: profile(false),
  brand_seeding: profile(false),
  other: profile(false),
};

export type ContentScoringInput = {
  videoType: string;
  scores: ReadonlyArray<{ dimension: ContentDimensionCode; rating: number }>;
  complianceRisks: ReadonlyArray<{ severity: 'high' | 'medium' | 'low' }>;
};

export type CalculatedContentScore = {
  scoringVersion: typeof CONTENT_SCORING_VERSION;
  baseScore: number;
  totalScore: number;
  contentGrade: ContentGrade;
  hardCap: number;
  reasonCodes: ContentScoreReasonCode[];
};

export function gradeFromScore(score: number): ContentGrade {
  if (score >= 90) return 'S';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

export function calculateContentScore(input: ContentScoringInput): CalculatedContentScore {
  const scoringProfile = CONTENT_SCORING_PROFILES[input.videoType as ContentScoringVideoType]
    || CONTENT_SCORING_PROFILES.other;
  const baseScore = Math.round(input.scores.reduce(
    (sum, item) => sum + item.rating / 5 * scoringProfile.weights[item.dimension],
    0,
  ));
  const reasonCodes: ContentScoreReasonCode[] = [];
  let hardCap = 100;

  if (input.complianceRisks.some((risk) => risk.severity === 'high')) {
    hardCap = 59;
    reasonCodes.push('HIGH_COMPLIANCE_RISK');
  }

  const productExposure = input.scores.find((item) => item.dimension === 'product_exposure');
  if (scoringProfile.requiresProductExposure && productExposure?.rating === 0) {
    hardCap = Math.min(hardCap, 69);
    reasonCodes.push('REQUIRED_PRODUCT_NOT_VISIBLE');
  }

  const totalScore = Math.min(baseScore, hardCap);
  return {
    scoringVersion: CONTENT_SCORING_VERSION,
    baseScore,
    totalScore,
    contentGrade: gradeFromScore(totalScore),
    hardCap,
    reasonCodes,
  };
}
