import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ContentReviewOutputValidationError } from '../modules/ai/gemini/gemini.errors';
import { contentDimensionCodes } from '../modules/ai/gemini/content-scoring';
import {
  contentReviewResponseJsonSchema,
  validateContentReviewOutput,
} from '../modules/ai/gemini/gemini.schema';

const scores = contentDimensionCodes.map((dimension) => ({
  dimension,
  rating: 4,
  evidence: `${dimension} evidence`,
  timestamp: '00:03',
}));

const validOutput = {
  contentSummary: '产品露出清晰，前段节奏较好。',
  isPublishableRecommendation: true,
  mainProblems: [{ dimension: '节奏', description: '中段略慢', timestamp: '00:08', severity: 'low' }],
  revisionSuggestions: [{ problem: '中段略慢', suggestion: '压缩停留镜头', priority: 'medium' }],
  complianceRisks: [{ riskType: '绝对化用语', description: '需核实字幕', timestamp: '00:06', severity: 'low' }],
  usableScenarios: ['商品卡视频'],
  scores,
};

test('content review schema accepts a valid structured result', () => {
  assert.equal(validateContentReviewOutput(validOutput).scores.length, 12);
});

test('content review schema rejects invalid JSON input', () => {
  assert.throws(() => validateContentReviewOutput('not-json'), ContentReviewOutputValidationError);
});

test('content review schema rejects missing required fields', () => {
  const { contentSummary: _contentSummary, ...missingField } = validOutput;
  assert.throws(() => validateContentReviewOutput(missingField), ContentReviewOutputValidationError);
});

test('content review schema rejects a rating outside zero to five', () => {
  assert.throws(
    () => validateContentReviewOutput({
      ...validOutput,
      scores: scores.map((item, index) => index === 0 ? { ...item, rating: 6 } : item),
    }),
    ContentReviewOutputValidationError,
  );
});

test('content review schema rejects missing dimensions', () => {
  assert.throws(
    () => validateContentReviewOutput({ ...validOutput, scores: scores.slice(0, 11) }),
    ContentReviewOutputValidationError,
  );
});

test('content review schema rejects duplicate dimensions', () => {
  assert.throws(
    () => validateContentReviewOutput({
      ...validOutput,
      scores: scores.map((item, index) => index === 1 ? { ...item, dimension: 'hook' } : item),
    }),
    ContentReviewOutputValidationError,
  );
});

test('content review schema rejects model-reported totals and grades', () => {
  assert.throws(
    () => validateContentReviewOutput({ ...validOutput, totalScore: 85, contentGrade: 'A' }),
    ContentReviewOutputValidationError,
  );
});

test('JSON schema fixes the dimension list and rating scale', () => {
  const scoreSchema = contentReviewResponseJsonSchema.properties.scores;
  assert.equal(scoreSchema.minItems, 12);
  assert.equal(scoreSchema.maxItems, 12);
  assert.deepEqual(scoreSchema.items.properties.dimension.enum, contentDimensionCodes);
  assert.equal(scoreSchema.items.properties.rating.minimum, 0);
  assert.equal(scoreSchema.items.properties.rating.maximum, 5);
});

test('content review schema rejects arrays returned as strings', () => {
  assert.throws(
    () => validateContentReviewOutput({ ...validOutput, usableScenarios: '商品卡视频' }),
    ContentReviewOutputValidationError,
  );
});
