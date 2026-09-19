import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateContentScore,
  contentDimensionCodes,
  CONTENT_SCORING_PROFILES,
  gradeFromScore,
} from '../modules/ai/gemini/content-scoring';

function allRatings(rating: number) {
  return contentDimensionCodes.map((dimension) => ({ dimension, rating }));
}

test('content scoring profiles have exactly twelve dimensions and total one hundred weight', () => {
  for (const profile of Object.values(CONTENT_SCORING_PROFILES)) {
    assert.deepEqual(Object.keys(profile.weights).sort(), [...contentDimensionCodes].sort());
    assert.equal(Object.values(profile.weights).reduce((sum, weight) => sum + weight, 0), 100);
  }
});

test('all excellent dimension ratings produce a deterministic S score', () => {
  assert.deepEqual(calculateContentScore({
    videoType: 'product_card',
    scores: allRatings(5),
    complianceRisks: [],
  }), {
    scoringVersion: 'content-score-v2',
    baseScore: 100,
    totalScore: 100,
    contentGrade: 'S',
    hardCap: 100,
    reasonCodes: [],
  });
});

test('all good dimension ratings produce a deterministic A score', () => {
  const result = calculateContentScore({
    videoType: 'organic',
    scores: allRatings(4),
    complianceRisks: [],
  });
  assert.equal(result.baseScore, 80);
  assert.equal(result.totalScore, 80);
  assert.equal(result.contentGrade, 'A');
});

test('grade boundaries remain compatible with the published S to D bands', () => {
  const cases = [[100, 'S'], [90, 'S'], [89, 'A'], [80, 'A'], [79, 'B'],
    [70, 'B'], [69, 'C'], [60, 'C'], [59, 'D'], [0, 'D']] as const;
  for (const [score, grade] of cases) assert.equal(gradeFromScore(score), grade);
});

test('high compliance risk caps the deterministic score at 59', () => {
  assert.deepEqual(calculateContentScore({
    videoType: 'product_card',
    scores: allRatings(5),
    complianceRisks: [{ severity: 'high' }],
  }), {
    scoringVersion: 'content-score-v2',
    baseScore: 100,
    totalScore: 59,
    contentGrade: 'D',
    hardCap: 59,
    reasonCodes: ['HIGH_COMPLIANCE_RISK'],
  });
});

test('missing required product exposure caps commercial video at 69', () => {
  const scores = allRatings(5).map((item) => item.dimension === 'product_exposure'
    ? { ...item, rating: 0 }
    : item);
  const result = calculateContentScore({
    videoType: 'qianchuan_ad',
    scores,
    complianceRisks: [],
  });
  assert.equal(result.baseScore, 90);
  assert.equal(result.totalScore, 69);
  assert.equal(result.contentGrade, 'C');
  assert.deepEqual(result.reasonCodes, ['REQUIRED_PRODUCT_NOT_VISIBLE']);
});

test('high compliance risk takes precedence over missing required product exposure', () => {
  const scores = allRatings(5).map((item) => item.dimension === 'product_exposure'
    ? { ...item, rating: 0 }
    : item);
  const result = calculateContentScore({
    videoType: 'live_room_traffic',
    scores,
    complianceRisks: [{ severity: 'high' }],
  });
  assert.equal(result.hardCap, 59);
  assert.deepEqual(result.reasonCodes, ['HIGH_COMPLIANCE_RISK', 'REQUIRED_PRODUCT_NOT_VISIBLE']);
});

test('same scoring version and same inputs always produce the same result', () => {
  const input = { videoType: 'brand_seeding', scores: allRatings(3), complianceRisks: [] } as const;
  assert.deepEqual(calculateContentScore(input), calculateContentScore(input));
});
