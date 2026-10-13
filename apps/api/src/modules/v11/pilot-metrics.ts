const gradeOrder = ['D', 'C', 'B-', 'B', 'A', 'A+', 'S'] as const;

export type PilotSample = {
  sampleId: string;
  scores: number[];
  grades: string[];
  held: boolean;
  severeInstability: boolean;
  humanGrade?: string;
  adoptedGrade?: string;
  holdout?: boolean;
};

type PilotRunRow = {
  id: string;
  totalScore: unknown;
  contentRating: string | null;
  complianceStatus: string | null;
  structuredOutput: unknown;
  group: {
    videoId: string;
    pilotRun: boolean;
    independent: boolean;
    inputRevision: { evaluationFingerprint: string };
  };
};

type PilotRunReader = {
  v11EvaluationRun: {
    findMany(args: unknown): Promise<PilotRunRow[]>;
  };
};

function percentile(values: number[], percentileValue: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(percentileValue * sorted.length) - 1];
}

function gradeDistance(left: string, right: string) {
  const leftIndex = gradeOrder.indexOf(left as (typeof gradeOrder)[number]);
  const rightIndex = gradeOrder.indexOf(right as (typeof gradeOrder)[number]);
  return leftIndex < 0 || rightIndex < 0 ? null : Math.abs(leftIndex - rightIndex);
}

export function calculatePilotMetrics(samples: PilotSample[]) {
  const spreads = samples.map((sample) => Math.max(...sample.scores) - Math.min(...sample.scores));
  const repeatable = samples.filter((sample) => sample.grades.length >= 3);
  const severe = samples.filter((sample) => sample.severeInstability);
  const holdout = samples.filter((sample) => sample.holdout && sample.humanGrade && sample.adoptedGrade);
  const exact = holdout.filter((sample) => sample.humanGrade === sample.adoptedGrade).length;
  const twoGradeErrors = holdout.filter((sample) => (gradeDistance(sample.humanGrade!, sample.adoptedGrade!) ?? 0) >= 2).length;
  return {
    sampleCount: samples.length,
    repeatableSampleCount: repeatable.length,
    maxScoreDifference: spreads.length ? Math.max(...spreads) : null,
    p90MaxScoreDifference: percentile(spreads, 0.9),
    gradeConsistencyRate: repeatable.length ? repeatable.filter((sample) => new Set(sample.grades).size === 1).length / repeatable.length : null,
    severeInstabilityInterceptionRate: severe.length ? severe.filter((sample) => sample.held).length / severe.length : null,
    holdoutCount: holdout.length,
    exactGradeAccuracy: holdout.length ? exact / holdout.length : null,
    twoOrMoreGradeErrorRate: holdout.length ? twoGradeErrors / holdout.length : null,
  };
}

function anchorsFrom(row: PilotRunRow) {
  const dimensions = (row.structuredOutput as { dimensions?: Array<{ dimension?: unknown; anchor?: unknown }> } | null)?.dimensions ?? [];
  return Object.fromEntries(dimensions
    .filter((item): item is { dimension: string; anchor: number } => typeof item.dimension === 'string' && typeof item.anchor === 'number')
    .map((item) => [item.dimension, item.anchor]));
}

export function assemblePilotRunReport(rows: PilotRunRow[]) {
  const groups = new Map<string, PilotRunRow[]>();
  for (const row of rows) {
    const key = `${row.group.videoId}:${row.group.inputRevision.evaluationFingerprint}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map((runs) => {
    const scores = runs.map((run) => Number(run.totalScore));
    const ratings = runs.map((run) => run.contentRating).filter((value): value is string => Boolean(value));
    const complianceDifferences = [...new Set(runs.map((run) => run.complianceStatus).filter((value): value is string => Boolean(value)))];
    const anchors = runs.map(anchorsFrom);
    const dimensions = [...new Set(anchors.flatMap((item) => Object.keys(item)))];
    const anchorDifferences = Object.fromEntries(dimensions.map((dimension) => {
      const values = anchors.map((item) => item[dimension]).filter((value): value is number => typeof value === 'number');
      return [dimension, values.length ? Math.max(...values) - Math.min(...values) : 0];
    }));
    return {
      videoId: runs[0].group.videoId,
      fingerprint: runs[0].group.inputRevision.evaluationFingerprint,
      runIds: runs.map((run) => run.id),
      scores,
      ratings,
      maxDiff: scores.length ? Math.max(...scores) - Math.min(...scores) : null,
      gradeConsistent: ratings.length > 0 && new Set(ratings).size === 1,
      complianceDifferences,
      anchorDifferences,
    };
  });
}

export async function loadPilotRunReport(
  db: PilotRunReader,
  filter: { videoId?: string; fingerprint?: string } = {},
) {
  const rows = await db.v11EvaluationRun.findMany({
    where: {
      status: 'succeeded',
      group: {
        pilotRun: true,
        independent: true,
        ...(filter.videoId ? { videoId: filter.videoId } : {}),
        ...(filter.fingerprint ? { inputRevision: { evaluationFingerprint: filter.fingerprint } } : {}),
      },
    },
    include: { group: { include: { inputRevision: { select: { evaluationFingerprint: true } } } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return assemblePilotRunReport(rows);
}
