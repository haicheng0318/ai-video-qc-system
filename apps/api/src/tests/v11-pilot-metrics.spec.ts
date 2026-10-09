import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculatePilotMetrics } from '../modules/v11/pilot-metrics';

test('pilot metrics calculate stability, interception and holdout accuracy without model calls', () => {
  const result = calculatePilotMetrics([
    { sampleId: '1', scores: [80, 82, 81], grades: ['B', 'A', 'B'], held: false, severeInstability: false, humanGrade: 'B', adoptedGrade: 'B', holdout: true },
    { sampleId: '2', scores: [52, 81, 79], grades: ['D', 'B', 'B'], held: true, severeInstability: true, humanGrade: 'B', adoptedGrade: 'D', holdout: true },
  ]);
  assert.equal(result.maxScoreDifference, 29);
  assert.equal(result.p90MaxScoreDifference, 29);
  assert.equal(result.severeInstabilityInterceptionRate, 1);
  assert.equal(result.exactGradeAccuracy, 0.5);
  assert.equal(result.twoOrMoreGradeErrorRate, 0.5);
});

test('pilot metrics use null instead of inventing results for empty evidence', () => {
  const result = calculatePilotMetrics([]);
  assert.equal(result.p90MaxScoreDifference, null);
  assert.equal(result.gradeConsistencyRate, null);
  assert.equal(result.exactGradeAccuracy, null);
});
