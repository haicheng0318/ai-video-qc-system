import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateV11ContentScore,
  contentRatingFromScore,
  V11_CONTENT_DIMENSIONS,
  V11DimensionObservation,
} from '../modules/v11/content-scoring';
import { V11ContentModelOutputSchema } from '../modules/v11/content-schema';
import { assertEvidenceWithinDuration } from '../modules/v11/v11-content.service';

const observed = (anchor: number): V11DimensionObservation[] => V11_CONTENT_DIMENSIONS.map(({ code }) => ({
  dimension: code,
  observationStatus: 'observed' as const,
  anchor,
  facts: [`fact:${code}`],
  evidence: [{ startSeconds: 1, endSeconds: 2, reference: `segment:${code}`, description: code }],
  observation: `${code} observed`,
}));

test('V1.1 content scoring has eight frozen dimensions totaling one hundred weight', () => {
  assert.equal(V11_CONTENT_DIMENSIONS.length, 8);
  assert.equal(V11_CONTENT_DIMENSIONS.reduce((sum, item) => sum + item.weight, 0), 100);
});

test('backend calculates deterministic one-decimal content score from anchors', () => {
  const result = calculateV11ContentScore({
    dimensions: observed(3),
    compliance: { status: 'clear', facts: [] },
  });
  assert.equal(result.totalScore, 75);
  assert.equal(result.contentRating, 'B');
  assert.equal(result.complete, true);
  assert.equal(result.dimensions[0].score, 15);
});

test('rating boundaries exactly match the frozen V1.1 bands', () => {
  const cases = [
    [100, 'A+'], [90, 'A+'], [89.9, 'A'], [82, 'A'], [81.9, 'B'], [74, 'B'],
    [73.9, 'B-'], [68, 'B-'], [67.9, 'C'], [60, 'C'], [59.9, 'D'], [0, 'D'],
  ] as const;
  for (const [score, rating] of cases) assert.equal(contentRatingFromScore(score), rating);
});

test('invalid anchor is rejected instead of coerced', () => {
  const dimensions = observed(4);
  dimensions[0] = { ...dimensions[0], anchor: 5 };
  assert.throws(() => calculateV11ContentScore({ dimensions, compliance: { status: 'clear', facts: [] } }), /anchor/i);
});

test('unknown critical dimension produces incomplete result without score or rating', () => {
  const dimensions = observed(4);
  dimensions[0] = { ...dimensions[0], observationStatus: 'unknown', anchor: null };
  const result = calculateV11ContentScore({ dimensions, compliance: { status: 'clear', facts: [] } });
  assert.equal(result.complete, false);
  assert.equal(result.totalScore, null);
  assert.equal(result.contentRating, null);
  assert.deepEqual(result.unknownDimensions, ['opening_hook']);
});

test('compliance remains independent from the quality score', () => {
  const clear = calculateV11ContentScore({ dimensions: observed(4), compliance: { status: 'clear', facts: [] } });
  const confirmed = calculateV11ContentScore({ dimensions: observed(4), compliance: { status: 'confirmed', facts: ['risk'] } });
  assert.equal(clear.totalScore, confirmed.totalScore);
  assert.equal(clear.contentRating, confirmed.contentRating);
  assert.equal(confirmed.compliance.status, 'confirmed');
});

test('evidence must be ordered and remain within the frozen media duration', () => {
  const output = {
    dimensions: observed(3),
    compliance: { status: 'clear' as const, facts: [] },
  };
  const parsed = V11ContentModelOutputSchema.parse(output);
  assert.doesNotThrow(() => assertEvidenceWithinDuration(parsed, 2));
  parsed.dimensions[0].evidence[0].endSeconds = 2.1;
  assert.throws(() => assertEvidenceWithinDuration(parsed, 2), /duration/i);
  const reversed = { ...output, dimensions: output.dimensions.map((item, index) => index ? item : { ...item, evidence: [{ ...item.evidence[0], startSeconds: 3, endSeconds: 2 }] }) };
  assert.throws(() => V11ContentModelOutputSchema.parse(reversed));
});
