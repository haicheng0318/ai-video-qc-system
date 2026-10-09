import assert from 'node:assert/strict';
import { test } from 'node:test';
import { V11_CONTENT_DIMENSIONS, V11ContentRating } from '../modules/v11/content-scoring';
import { decideReviewProgress, requiresIndependentReview, ReviewRun } from '../modules/v11/review-engine';

const run = (score: number, rating: V11ContentRating, anchor = 3, factsHash = 'facts', complianceStatus: 'clear' | 'suspected' | 'confirmed' = 'clear'): ReviewRun => ({
  score,
  rating,
  anchors: Object.fromEntries(V11_CONTENT_DIMENSIONS.map((item) => [item.code, anchor])) as ReviewRun['anchors'],
  factsHash,
  complianceStatus,
});

test('first fifty eligible samples and first A+ always require independent review', () => {
  assert.equal(requiresIndependentReview({ eligiblePilotCount: 0, fingerprint: 'x', score: 80, rating: 'B' }), true);
  assert.equal(requiresIndependentReview({ eligiblePilotCount: 50, fingerprint: 'x', score: 91, rating: 'A+' }), true);
});

test('boundary, history drift, appeal and deterministic ten percent sample trigger review', () => {
  assert.equal(requiresIndependentReview({ eligiblePilotCount: 50, fingerprint: 'x', score: 82.5, rating: 'A' }), true);
  assert.equal(requiresIndependentReview({ eligiblePilotCount: 50, fingerprint: 'x', score: 80, rating: 'B', comparableHistoricalScore: 73 }), true);
  assert.equal(requiresIndependentReview({ eligiblePilotCount: 50, fingerprint: 'x', score: 80, rating: 'B', appeal: true }), true);
  const seeded = Array.from({ length: 1000 }, (_, index) => `seed-${index}`).find((fingerprint) => requiresIndependentReview({ eligiblePilotCount: 50, fingerprint, score: 78, rating: 'B' }));
  assert.ok(seeded);
});

test('stable double review adopts averaged dimensions and backend rating', () => {
  const result = decideReviewProgress([run(75, 'B', 3), run(76, 'B', 3)]);
  assert.equal(result.action, 'adopt');
  assert.equal(result.method, 'double_average');
  assert.equal(result.contentRating, 'B');
});

test('score difference over ten and two-level difference go directly to hold', () => {
  assert.equal(decideReviewProgress([run(70, 'B-', 3), run(81, 'B', 3)]).action, 'hold');
  assert.equal(decideReviewProgress([run(83, 'A', 3), run(73, 'B-', 3)]).action, 'hold');
});

test('anchor difference of two requests a third blind review when no direct hold applies', () => {
  const result = decideReviewProgress([run(75, 'B', 2), run(78, 'B', 4)]);
  assert.equal(result.action, 'third_review');
});

test('major fact or compliance conflict goes directly to hold', () => {
  assert.equal(decideReviewProgress([run(75, 'B', 3, 'a'), run(76, 'B', 3, 'b')]).action, 'hold');
  assert.equal(decideReviewProgress([run(75, 'B', 3, 'a', 'clear'), run(76, 'B', 3, 'a', 'confirmed')]).action, 'hold');
});

test('three reviews adopt median anchors only when majority rating matches backend rating', () => {
  const result = decideReviewProgress([run(75, 'B', 3), run(77, 'B', 3), run(78, 'B', 3)]);
  assert.equal(result.action, 'adopt');
  assert.equal(result.method, 'triple_median');
  assert.equal(result.contentRating, 'B');
});

test('52 81 79 severe instability is held rather than averaged or median adopted', () => {
  const result = decideReviewProgress([run(52, 'D', 2), run(81, 'B', 3), run(79, 'B', 3)]);
  assert.equal(result.action, 'hold');
});

test('review engine never requests more than three valid scoring runs', () => {
  assert.throws(() => decideReviewProgress([run(70, 'B-', 3), run(72, 'B-', 3), run(73, 'B-', 3), run(74, 'B', 3)]), /three/i);
});
