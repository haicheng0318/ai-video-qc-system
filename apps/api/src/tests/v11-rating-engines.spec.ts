import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateDataRating } from '../modules/v11/data-rating-engine';
import { comprehensiveRatingFor, resolveManualR, V11_COMPREHENSIVE_MATRIX } from '../modules/v11/comprehensive-matrix';

const thresholds = { metricName: 'roi', direction: 'higher_better' as const, S: 5, 'A+': 4, A: 3, B: 2, 'B-': 1.5, C: 1 };

test('missing approved benchmark or required data is insufficient and never D', () => {
  assert.deepEqual(calculateDataRating({ metrics: {}, thresholds: null, requiredMetrics: [], minimumSampleMetric: 'impressions', minimumSampleValue: 100, observationWindowDays: 1 }), { dataSufficiency: 'insufficient', dataRating: null, reason: 'benchmark_missing', guardApplications: [] });
  assert.equal(calculateDataRating({ metrics: { impressions: 1000 }, thresholds, requiredMetrics: ['roi'], minimumSampleMetric: 'impressions', minimumSampleValue: 100, observationWindowDays: 1, dataStartDate: '2026-01-01', dataEndDate: '2026-01-01' }).dataRating, null);
});

test('zero is data rather than null and guard rules can only cap a rating', () => {
  const result = calculateDataRating({ metrics: { impressions: 1000, roi: 5, cvr: 0 }, thresholds, requiredMetrics: ['roi', 'cvr'], minimumSampleMetric: 'impressions', minimumSampleValue: 100, observationWindowDays: 1, dataStartDate: '2026-01-01', dataEndDate: '2026-01-01', guards: [{ metric: 'cvr', operator: 'lte', value: 0, capRating: 'C' }] });
  assert.equal(result.dataSufficiency, 'sufficient');
  assert.equal(result.dataRating, 'C');
});

test('S requires both S threshold and sufficient sample and observation window', () => {
  const sufficient = calculateDataRating({ metrics: { impressions: 1000, roi: 5 }, thresholds, requiredMetrics: ['roi'], minimumSampleMetric: 'impressions', minimumSampleValue: 1000, observationWindowDays: 3, dataStartDate: '2026-01-01', dataEndDate: '2026-01-03' });
  assert.equal(sufficient.dataRating, 'S');
  const short = calculateDataRating({ metrics: { impressions: 1000, roi: 5 }, thresholds, requiredMetrics: ['roi'], minimumSampleMetric: 'impressions', minimumSampleValue: 1000, observationWindowDays: 3, dataStartDate: '2026-01-01', dataEndDate: '2026-01-02' });
  assert.equal(short.dataRating, null);
});

test('all forty-two frozen comprehensive combinations are present and deterministic', () => {
  const contents = ['A+', 'A', 'B', 'B-', 'C', 'D'] as const;
  const data = ['S', 'A+', 'A', 'B', 'B-', 'C', 'D'] as const;
  const expected = {
    'A+': ['S', 'A+', 'A', 'A', 'B', 'B-', 'C'],
    A: ['A+', 'A+', 'A', 'B', 'B-', 'C', 'C'],
    B: ['A', 'A', 'A', 'B', 'B-', 'C', 'D'],
    'B-': ['R', 'R', 'B', 'B-', 'C', 'C', 'D'],
    C: ['R', 'R', 'R', 'R', 'C', 'D', 'D'],
    D: ['R', 'R', 'R', 'R', 'C', 'D', 'D'],
  } as const;
  for (const content of contents) {
    data.forEach((grade, index) => assert.equal(V11_COMPREHENSIVE_MATRIX[content][grade], expected[content][index], `${content} + ${grade}`));
  }
  assert.equal(contents.length * data.length, 42);
  assert.equal(comprehensiveRatingFor('B-', 'S').requiresAdminReview, true);
  assert.equal(comprehensiveRatingFor('D', 'D').finalStatus, 'final_invalid');
});

test('R manual resolution is capped below S and A plus', () => {
  assert.throws(() => resolveManualR('S'), /cannot/i);
  assert.throws(() => resolveManualR('A+'), /cannot/i);
  assert.equal(resolveManualR('A'), 'A');
});
