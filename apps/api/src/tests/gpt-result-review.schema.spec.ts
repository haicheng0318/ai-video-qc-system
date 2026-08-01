import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ResultReviewOutputValidationError } from '../modules/ai/gpt/gpt.errors';
import {
  gradeForScore,
  resultReviewJsonSchema,
  validateResultReviewOutput,
} from '../modules/ai/gpt/gpt-result-review.schema';

const sufficient = {
  dataSufficiency: 'sufficient',
  sufficiencyReasons: [],
  dataScore: 85,
  dataGrade: 'A',
  isBusinessEffectiveRecommendation: true,
  resultSummary: '当前结构化数据达到分析条件，具备继续测试价值。',
  performanceProblems: [{
    metric: 'ctr', severity: 'medium', observedValue: '1.2', benchmarkValue: '2.0', description: '点击率低于当前业务基准。',
  }],
  attributionAnalysis: [{
    type: 'audience', confidence: 60, evidence: ['CTR 低于基准'], conclusion: '可能与人群匹配度有关。',
  }],
  optimizationSuggestions: [{
    priority: 'high', owner: 'delivery', action: '调整测试人群', rationale: '先排除投放人群干扰。',
  }],
  continueTestRecommendation: 'optimize_then_continue',
} as const;

const insufficient = {
  dataSufficiency: 'insufficient',
  sufficiencyReasons: [{
    code: 'missing_benchmark', description: '没有匹配的业务基准。', requiredNextData: ['配置对应平台基准'],
  }],
  dataScore: null,
  dataGrade: null,
  isBusinessEffectiveRecommendation: null,
  resultSummary: '当前数据不足，不能给出数据等级。',
  performanceProblems: [],
  attributionAnalysis: [{
    type: 'sample_size', confidence: 100, evidence: ['缺少匹配基准'], conclusion: '需要补充基准。',
  }],
  optimizationSuggestions: [{
    priority: 'high', owner: 'operation', action: '补充业务基准', rationale: '避免虚构行业阈值。',
  }],
  continueTestRecommendation: 'collect_more_data',
} as const;

test('valid sufficient result review output passes', () => {
  assert.equal(validateResultReviewOutput(sufficient).dataGrade, 'A');
});

test('valid insufficient result review output passes without score or grade', () => {
  const parsed = validateResultReviewOutput(insufficient);
  assert.equal(parsed.dataScore, null);
  assert.equal(parsed.dataGrade, null);
});

test('strict JSON Schema requires every top-level property and disallows extras', () => {
  assert.equal(resultReviewJsonSchema.additionalProperties, false);
  assert.equal(resultReviewJsonSchema.required.length, 10);
  for (const property of Object.values(resultReviewJsonSchema.properties)) {
    if ('items' in property && property.items && typeof property.items === 'object' && 'additionalProperties' in property.items) {
      assert.equal(property.items.additionalProperties, false);
    }
  }
});

for (const [label, mutate] of [
  ['extra field', (value: any) => { value.unexpected = true; }],
  ['invalid grade', (value: any) => { value.dataGrade = 'E'; }],
  ['negative score', (value: any) => { value.dataScore = -1; }],
  ['score above 100', (value: any) => { value.dataScore = 101; }],
  ['decimal score', (value: any) => { value.dataScore = 85.5; }],
  ['negative confidence', (value: any) => { value.attributionAnalysis[0].confidence = -1; }],
  ['confidence above 100', (value: any) => { value.attributionAnalysis[0].confidence = 101; }],
  ['invalid attribution type', (value: any) => { value.attributionAnalysis[0].type = 'personnel'; }],
  ['too many problems', (value: any) => { value.performanceProblems = Array(11).fill(value.performanceProblems[0]); }],
  ['too many attribution items', (value: any) => { value.attributionAnalysis = Array(10).fill(value.attributionAnalysis[0]); }],
  ['too many suggestions', (value: any) => { value.optimizationSuggestions = Array(11).fill(value.optimizationSuggestions[0]); }],
  ['summary too long', (value: any) => { value.resultSummary = 'x'.repeat(2001); }],
  ['sufficient score null', (value: any) => { value.dataScore = null; }],
  ['sufficient grade null', (value: any) => { value.dataGrade = null; }],
  ['sufficient recommendation null', (value: any) => { value.isBusinessEffectiveRecommendation = null; }],
  ['sufficient reasons not empty', (value: any) => { value.sufficiencyReasons = insufficient.sufficiencyReasons; }],
  ['score and grade mismatch', (value: any) => { value.dataScore = 95; value.dataGrade = 'A'; }],
] as const) {
  test(`${label} is rejected by result review validation`, () => {
    const value = structuredClone(sufficient) as any;
    mutate(value);
    assert.throws(() => validateResultReviewOutput(value), ResultReviewOutputValidationError);
  });
}

for (const [label, mutate] of [
  ['insufficient score present', (value: any) => { value.dataScore = 0; }],
  ['insufficient grade present', (value: any) => { value.dataGrade = 'D'; }],
  ['insufficient recommendation present', (value: any) => { value.isBusinessEffectiveRecommendation = false; }],
  ['insufficient reasons missing', (value: any) => { value.sufficiencyReasons = []; }],
  ['insufficient continuation wrong', (value: any) => { value.continueTestRecommendation = 'pause'; }],
  ['insufficient evidence missing', (value: any) => {
    value.sufficiencyReasons = [{ code: 'other', description: '不明确', requiredNextData: [] }];
    value.attributionAnalysis = [];
  }],
] as const) {
  test(`${label} is rejected by cross-field validation`, () => {
    const value = structuredClone(insufficient) as any;
    mutate(value);
    assert.throws(() => validateResultReviewOutput(value), ResultReviewOutputValidationError);
  });
}

for (const [score, grade] of [[100, 'S'], [90, 'S'], [89, 'A'], [80, 'A'], [79, 'B'], [70, 'B'], [69, 'C'], [60, 'C'], [59, 'D'], [0, 'D']] as const) {
  test(`score ${score} maps to grade ${grade}`, () => assert.equal(gradeForScore(score), grade));
}
