import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeminiOutputValidationError } from '../modules/ai/gemini/gemini.errors';
import { validateContentReviewOutput } from '../modules/ai/gemini/gemini.schema';

const validOutput = {
  contentSummary: '产品露出清晰，前段节奏较好。',
  totalScore: 86,
  contentGrade: 'A',
  isPublishableRecommendation: true,
  mainProblems: [{ dimension: '节奏', description: '中段略慢', timestamp: '00:08', severity: 'low' }],
  revisionSuggestions: [{ problem: '中段略慢', suggestion: '压缩停留镜头', priority: 'medium' }],
  complianceRisks: [],
  usableScenarios: ['商品卡视频'],
  scores: [{ dimension: '前3秒吸引力', score: 17, maxScore: 20, comment: '开头信息明确' }],
};

test('Gemini schema accepts a valid structured result', () => {
  assert.equal(validateContentReviewOutput(validOutput).contentGrade, 'A');
});

test('Gemini schema rejects invalid JSON input', () => {
  assert.throws(() => validateContentReviewOutput('not-json'), GeminiOutputValidationError);
});

test('Gemini schema rejects missing required fields', () => {
  const { contentSummary: _contentSummary, ...missingField } = validOutput;
  assert.throws(() => validateContentReviewOutput(missingField), GeminiOutputValidationError);
});

test('Gemini schema rejects score greater than maxScore', () => {
  assert.throws(
    () => validateContentReviewOutput({
      ...validOutput,
      scores: [{ dimension: '节奏', score: 21, maxScore: 20, comment: 'invalid' }],
    }),
    GeminiOutputValidationError,
  );
});

test('Gemini schema rejects a grade inconsistent with totalScore', () => {
  assert.throws(
    () => validateContentReviewOutput({ ...validOutput, totalScore: 95, contentGrade: 'A' }),
    GeminiOutputValidationError,
  );
});

test('Gemini schema rejects arrays returned as strings', () => {
  assert.throws(
    () => validateContentReviewOutput({ ...validOutput, usableScenarios: '商品卡视频' }),
    GeminiOutputValidationError,
  );
});
