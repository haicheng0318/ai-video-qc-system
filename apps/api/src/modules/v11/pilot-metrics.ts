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
