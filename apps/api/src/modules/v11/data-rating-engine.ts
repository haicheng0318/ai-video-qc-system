export const V11_DATA_RATING_VERSION = 'data-rating-v1.1-r1';
export type V11DataRating = 'S' | 'A+' | 'A' | 'B' | 'B-' | 'C' | 'D';

export type BenchmarkThresholds = {
  metricName: string;
  direction: 'higher_better' | 'lower_better';
  S: number;
  'A+': number;
  A: number;
  B: number;
  'B-': number;
  C: number;
};

export type GuardRule = {
  metric: string;
  operator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq';
  value: number;
  capRating: V11DataRating;
};

const order: V11DataRating[] = ['S', 'A+', 'A', 'B', 'B-', 'C', 'D'];

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validateThresholdOrder(thresholds: BenchmarkThresholds) {
  const values = [thresholds.S, thresholds['A+'], thresholds.A, thresholds.B, thresholds['B-'], thresholds.C];
  if (!values.every(Number.isFinite)) throw new Error('Benchmark thresholds must be finite.');
  const valid = thresholds.direction === 'higher_better'
    ? values.every((value, index) => index === 0 || values[index - 1] >= value)
    : values.every((value, index) => index === 0 || values[index - 1] <= value);
  if (!valid) throw new Error('Benchmark thresholds are not ordered.');
}

function ratingFor(value: number, thresholds: BenchmarkThresholds): V11DataRating {
  validateThresholdOrder(thresholds);
  for (const rating of order.slice(0, 6) as Exclude<V11DataRating, 'D'>[]) {
    const threshold = thresholds[rating];
    if (thresholds.direction === 'higher_better' ? value >= threshold : value <= threshold) return rating;
  }
  return 'D';
}

function matches(value: number, rule: GuardRule) {
  if (rule.operator === 'lt') return value < rule.value;
  if (rule.operator === 'lte') return value <= rule.value;
  if (rule.operator === 'gt') return value > rule.value;
  if (rule.operator === 'gte') return value >= rule.value;
  return value === rule.value;
}

export function calculateDataRating(input: {
  metrics: Record<string, unknown>;
  thresholds: BenchmarkThresholds | null;
  requiredMetrics: string[];
  minimumSampleMetric: string;
  minimumSampleValue: number;
  observationWindowDays: number;
  dataStartDate?: Date | string | null;
  dataEndDate?: Date | string | null;
  guards?: GuardRule[];
}) {
  if (!input.thresholds) return { dataSufficiency: 'insufficient' as const, dataRating: null, reason: 'benchmark_missing', guardApplications: [] };
  const missing = input.requiredMetrics.filter((metric) => finite(input.metrics[metric]) === null);
  if (missing.length) return { dataSufficiency: 'insufficient' as const, dataRating: null, reason: 'required_metrics_missing', missingMetrics: missing, guardApplications: [] };
  const sample = finite(input.metrics[input.minimumSampleMetric]);
  if (sample === null || sample < input.minimumSampleValue) return { dataSufficiency: 'insufficient' as const, dataRating: null, reason: 'minimum_sample_not_met', guardApplications: [] };
  const start = input.dataStartDate ? new Date(input.dataStartDate) : null;
  const end = input.dataEndDate ? new Date(input.dataEndDate) : null;
  const observedDays = start && end && Number.isFinite(+start) && Number.isFinite(+end) ? Math.floor((+end - +start) / 86400000) + 1 : 0;
  if (observedDays < input.observationWindowDays) return { dataSufficiency: 'insufficient' as const, dataRating: null, reason: 'observation_window_not_met', guardApplications: [] };
  const primary = finite(input.metrics[input.thresholds.metricName]);
  if (primary === null) return { dataSufficiency: 'insufficient' as const, dataRating: null, reason: 'primary_metric_missing', guardApplications: [] };
  let rating = ratingFor(primary, input.thresholds);
  const guardApplications: Array<{ metric: string; capRating: V11DataRating }> = [];
  for (const guard of input.guards || []) {
    const value = finite(input.metrics[guard.metric]);
    if (value !== null && matches(value, guard) && order.indexOf(rating) < order.indexOf(guard.capRating)) {
      rating = guard.capRating;
      guardApplications.push({ metric: guard.metric, capRating: guard.capRating });
    }
  }
  return { dataSufficiency: 'sufficient' as const, dataRating: rating, primaryMetricValue: primary, reason: null, guardApplications };
}
