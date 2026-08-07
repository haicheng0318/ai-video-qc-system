import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  allowedRecommendations,
  finalEvaluationJsonSchema,
  validateFinalEvaluationOutput,
} from '../modules/ai/gpt/gpt-final-evaluation.schema';
import { FinalEvaluationOutputValidationError } from '../modules/ai/gpt/gpt.errors';
import { RecommendedBoundary } from '@ai-video-qc/shared';

function output(grade: 'effective' | 'low_effective' | 'invalid' = 'effective'): any {
  const mapping = {
    effective: ['final_effective', true],
    low_effective: ['final_low_effective', true],
    invalid: ['final_invalid', false],
  } as const;
  return {
    recommendedFinalGrade: grade,
    recommendedFinalStatus: mapping[grade][0],
    recommendedIsEffective: mapping[grade][1],
    recommendationConfidence: 82,
    decisionSummary: '现有证据支持该建议，仍待负责人确认。',
    evidenceAssessment: [
      { source: 'content_review', strength: 'high', evidence: ['内容等级已确定'], conclusion: '内容证据可用' },
      { source: 'result_review', strength: 'high', evidence: ['数据等级已确定'], conclusion: '数据证据可用' },
      { source: 'rule_engine', strength: 'high', evidence: ['规则边界已确定'], conclusion: '建议在边界内' },
    ],
    finalAttribution: [{ type: 'mixed', confidence: 70, evidence: ['内容与数据综合证据'], conclusion: '综合因素影响' }],
    finalSuggestion: '建议负责人结合业务背景复核。',
    confirmationFocus: ['核对业务背景与证据完整性'],
    riskFlags: [],
  };
}

test('strict JSON Schema has the required final-evaluation contract', () => {
  assert.equal(finalEvaluationJsonSchema.additionalProperties, false);
  assert.equal(finalEvaluationJsonSchema.required.length, 10);
  assert.equal(finalEvaluationJsonSchema.properties.evidenceAssessment.items.additionalProperties, false);
  assert.equal(finalEvaluationJsonSchema.properties.finalAttribution.items.additionalProperties, false);
  assert.equal(finalEvaluationJsonSchema.properties.riskFlags.items.additionalProperties, false);
});

for (const [grade, boundary] of [
  ['effective', 'allow_final_effective'],
  ['low_effective', 'allow_final_effective_or_low_effective'],
  ['invalid', 'require_final_invalid'],
] as const) {
  test(`valid ${grade} final suggestion passes`, () => {
    assert.equal(validateFinalEvaluationOutput(output(grade), boundary).recommendedFinalGrade, grade);
  });
}

const boundaries: Array<[RecommendedBoundary, string[]]> = [
  ['allow_final_effective', ['effective']],
  ['allow_final_effective_or_low_effective', ['effective', 'low_effective']],
  ['allow_final_low_effective_or_invalid', ['low_effective', 'invalid']],
  ['require_manual_confirmation', ['effective', 'low_effective', 'invalid']],
  ['require_final_invalid', ['invalid']],
  ['pending_data', []],
];
for (const [boundary, expected] of boundaries) {
  test(`${boundary} exposes only its backend allowed recommendations`, () => {
    assert.deepEqual([...allowedRecommendations(boundary)], expected);
  });
  for (const grade of ['effective', 'low_effective', 'invalid'] as const) {
    test(`${boundary} ${expected.includes(grade) ? 'allows' : 'rejects'} ${grade}`, () => {
      const value = output(grade);
      if (boundary === 'require_manual_confirmation') {
        value.decisionSummary = '内容与数据存在偏差，需要负责人复核。';
        value.riskFlags = [{ code: 'content_data_conflict', description: '内容与数据存在冲突。' }];
      }
      if (expected.includes(grade)) {
        assert.equal(validateFinalEvaluationOutput(value, boundary).recommendedFinalGrade, grade);
      } else {
        assert.throws(() => validateFinalEvaluationOutput(value, boundary), FinalEvaluationOutputValidationError);
      }
    });
  }
}

const invalidMutations: Array<[string, (value: any) => void]> = [
  ['extra top-level field', (value) => { value.extra = true; }],
  ['invalid grade', (value) => { value.recommendedFinalGrade = 'excellent'; }],
  ['invalid status', (value) => { value.recommendedFinalStatus = 'pending'; }],
  ['negative confidence', (value) => { value.recommendationConfidence = -1; }],
  ['confidence above 100', (value) => { value.recommendationConfidence = 101; }],
  ['decimal confidence', (value) => { value.recommendationConfidence = 80.5; }],
  ['attribution confidence below zero', (value) => { value.finalAttribution[0].confidence = -1; }],
  ['attribution confidence above 100', (value) => { value.finalAttribution[0].confidence = 101; }],
  ['empty attribution', (value) => { value.finalAttribution = []; }],
  ['empty confirmation focus', (value) => { value.confirmationFocus = []; }],
  ['too many confirmation focus items', (value) => { value.confirmationFocus = Array(11).fill('复核'); }],
  ['too many risk flags', (value) => { value.riskFlags = Array(11).fill({ code: 'other', description: '风险' }); }],
  ['too many attribution items', (value) => { value.finalAttribution = Array(11).fill(value.finalAttribution[0]); }],
  ['too many evidence groups', (value) => { value.evidenceAssessment = Array(11).fill(value.evidenceAssessment[0]); }],
  ['empty evidence item', (value) => { value.evidenceAssessment[0].evidence = []; }],
  ['too many evidence items', (value) => { value.evidenceAssessment[0].evidence = Array(9).fill('证据'); }],
  ['decision summary too long', (value) => { value.decisionSummary = 'a'.repeat(2001); }],
  ['final suggestion too long', (value) => { value.finalSuggestion = 'a'.repeat(2001); }],
  ['evidence string too long', (value) => { value.evidenceAssessment[0].evidence = ['a'.repeat(501)]; }],
  ['missing content evidence', (value) => { value.evidenceAssessment[0].source = 'supervisor_review'; }],
  ['missing result review evidence', (value) => { value.evidenceAssessment[1].source = 'supervisor_review'; }],
  ['missing rule evidence', (value) => { value.evidenceAssessment[2].source = 'supervisor_review'; }],
  ['mapping status mismatch', (value) => { value.recommendedFinalStatus = 'final_invalid'; }],
  ['mapping effectiveness mismatch', (value) => { value.recommendedIsEffective = false; }],
  ['risk item extra field', (value) => { value.riskFlags = [{ code: 'other', description: '风险', extra: true }]; }],
  ['attribution item extra field', (value) => { value.finalAttribution[0].extra = true; }],
  ['evidence item extra field', (value) => { value.evidenceAssessment[0].extra = true; }],
];
for (const [name, mutate] of invalidMutations) {
  test(`${name} fails final output validation`, () => {
    const value: any = structuredClone(output());
    mutate(value);
    assert.throws(() => validateFinalEvaluationOutput(value, 'allow_final_effective'), FinalEvaluationOutputValidationError);
  });
}

for (const phrase of [
  '已最终确认', '负责人已确认', '已计入绩效', '已完成最终审批',
  'confirmed by owner', 'performance approved',
]) {
  for (const field of ['decisionSummary', 'finalSuggestion', 'confirmationFocus', 'riskFlags'] as const) {
    test(`prohibited phrase ${phrase} in ${field} is rejected`, () => {
      const value: any = output();
      if (field === 'confirmationFocus') value[field] = [phrase];
      else if (field === 'riskFlags') value[field] = [{ code: 'other', description: phrase }];
      else value[field] = phrase;
      assert.throws(() => validateFinalEvaluationOutput(value, 'allow_final_effective'), FinalEvaluationOutputValidationError);
    });
  }
}

for (const risk of ['content_data_conflict', 'boundary_sensitive'] as const) {
  test(`manual confirmation accepts ${risk} with explicit deviation`, () => {
    const value = output();
    value.decisionSummary = '内容判断与数据表现存在偏差，建议负责人确认。';
    value.riskFlags = [{ code: risk, description: '边界敏感，需要人工判断。' }];
    assert.equal(validateFinalEvaluationOutput(value, 'require_manual_confirmation').recommendedFinalGrade, 'effective');
  });
}

for (const missing of ['risk', 'deviation'] as const) {
  test(`manual confirmation rejects missing ${missing} evidence`, () => {
    const value = output();
    if (missing === 'risk') value.decisionSummary = '内容与数据存在偏差。';
    else value.riskFlags = [{ code: 'boundary_sensitive', description: '边界敏感。' }];
    assert.throws(() => validateFinalEvaluationOutput(value, 'require_manual_confirmation'), FinalEvaluationOutputValidationError);
  });
}
