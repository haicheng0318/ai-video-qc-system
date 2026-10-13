import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assemblePilotRunReport, calculatePilotMetrics, loadPilotRunReport } from '../modules/v11/pilot-metrics';

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

test('pilot report aggregates succeeded independent runs by video and fingerprint without decisions', async () => {
  const rows = [
    { id: 'run-1', totalScore: 82.5, contentRating: 'A', complianceStatus: 'clear', structuredOutput: { dimensions: [{ dimension: 'opening_hook', anchor: 3 }] }, group: { videoId: 'video-1', pilotRun: true, independent: true, inputRevision: { evaluationFingerprint: 'fingerprint-1' } } },
    { id: 'run-2', totalScore: 85, contentRating: 'A', complianceStatus: 'suspected', structuredOutput: { dimensions: [{ dimension: 'opening_hook', anchor: 4 }] }, group: { videoId: 'video-1', pilotRun: true, independent: true, inputRevision: { evaluationFingerprint: 'fingerprint-1' } } },
  ];
  let query: any;
  const report = await loadPilotRunReport({
    v11EvaluationRun: {
      findMany: async (value: any) => { query = value; return rows; },
    },
  } as any, { videoId: 'video-1', fingerprint: 'fingerprint-1' });

  assert.equal(query.where.status, 'succeeded');
  assert.equal(query.where.group.pilotRun, true);
  assert.equal(query.where.group.independent, true);
  assert.equal(query.where.group.videoId, 'video-1');
  assert.equal(query.where.group.inputRevision.evaluationFingerprint, 'fingerprint-1');
  assert.deepEqual(report, assemblePilotRunReport(rows as any));
  assert.deepEqual(report[0].scores, [82.5, 85]);
  assert.deepEqual(report[0].ratings, ['A', 'A']);
  assert.equal(report[0].maxDiff, 2.5);
  assert.equal(report[0].gradeConsistent, true);
  assert.deepEqual(report[0].complianceDifferences, ['clear', 'suspected']);
  assert.deepEqual(report[0].anchorDifferences, { opening_hook: 1 });
});
