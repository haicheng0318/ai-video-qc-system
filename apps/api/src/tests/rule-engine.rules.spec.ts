import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  contentGrades,
  dataGrades,
  recommendedBoundaries,
  ruleCodes,
  ruleResults,
} from '@ai-video-qc/shared';
import {
  evaluateRuleBoundary,
  RuleEngineInputError,
  RULE_ENGINE_V1_RULES,
} from '../modules/rule-engine/rule-engine.rules';

const expectedByGroup = {
  high_high: ['R11_CONTENT_HIGH_DATA_HIGH', 'excellent_effective_candidate', 'allow_final_effective'],
  high_mid: ['R12_CONTENT_HIGH_DATA_MID', 'effective_candidate', 'allow_final_effective'],
  high_low: ['R13_CONTENT_HIGH_DATA_LOW', 'content_good_result_poor', 'allow_final_low_effective_or_invalid'],
  mid_high: ['R21_CONTENT_MID_DATA_HIGH', 'potential_effective_candidate', 'allow_final_effective_or_low_effective'],
  mid_mid: ['R22_CONTENT_MID_DATA_MID', 'basic_effective_candidate', 'allow_final_effective_or_low_effective'],
  mid_low: ['R23_CONTENT_MID_DATA_LOW', 'content_good_result_poor', 'allow_final_low_effective_or_invalid'],
  low_high: ['R31_CONTENT_LOW_DATA_HIGH', 'abnormal_need_confirmation', 'require_manual_confirmation'],
  low_mid: ['R32_CONTENT_LOW_DATA_MID', 'abnormal_need_confirmation', 'require_manual_confirmation'],
  low_low: ['R33_CONTENT_LOW_DATA_LOW', 'invalid_candidate', 'require_final_invalid'],
} as const;

const group = (grade: string) => grade === 'S' || grade === 'A' ? 'high' : grade === 'B' ? 'mid' : 'low';

for (const contentGrade of contentGrades) {
  for (const dataGrade of dataGrades) {
    test(`${contentGrade} + ${dataGrade} sufficient hits exactly one phase 6 rule`, () => {
      const result = evaluateRuleBoundary({ contentGrade, dataGrade, dataSufficiency: 'sufficient' });
      const expected = expectedByGroup[`${group(contentGrade)}_${group(dataGrade)}` as keyof typeof expectedByGroup];
      assert.deepEqual(
        [result.ruleCode, result.ruleResult, result.recommendedBoundary],
        expected,
      );
      assert.match(result.ruleReason, new RegExp(result.ruleCode.slice(0, 3)));
    });
  }
}

for (const contentGrade of contentGrades) {
  test(`insufficient ${contentGrade} hits R00 without inventing a data grade`, () => {
    const result = evaluateRuleBoundary({ contentGrade, dataGrade: null, dataSufficiency: 'insufficient' });
    assert.equal(result.ruleCode, 'R00_DATA_INSUFFICIENT');
    assert.equal(result.ruleResult, 'pending_data');
    assert.equal(result.recommendedBoundary, 'pending_data');
    assert.equal(result.dataGrade, null);
  });
}

for (const contentGrade of contentGrades) {
  for (const dataGrade of dataGrades) {
    test(`${contentGrade} + ${dataGrade} is deterministic across repeated execution`, () => {
      const input = { contentGrade, dataGrade, dataSufficiency: 'sufficient' };
      assert.deepEqual(evaluateRuleBoundary(input), evaluateRuleBoundary(input));
    });
  }
}

for (const invalid of [null, undefined, '', 's', 'a', 'E', ' A ', 1]) {
  test(`invalid content grade ${String(invalid)} throws without fallback`, () => {
    assert.throws(
      () => evaluateRuleBoundary({ contentGrade: invalid, dataGrade: 'A', dataSufficiency: 'sufficient' }),
      RuleEngineInputError,
    );
  });
}

for (const invalid of [null, undefined, '', 'a', 'E', ' A ', 1]) {
  test(`invalid sufficient data grade ${String(invalid)} throws without fallback`, () => {
    assert.throws(
      () => evaluateRuleBoundary({ contentGrade: 'A', dataGrade: invalid, dataSufficiency: 'sufficient' }),
      RuleEngineInputError,
    );
  });
}

for (const invalid of ['pending', null, undefined, '', 'Sufficient']) {
  test(`invalid data sufficiency ${String(invalid)} throws`, () => {
    assert.throws(
      () => evaluateRuleBoundary({ contentGrade: 'A', dataGrade: 'A', dataSufficiency: invalid }),
      RuleEngineInputError,
    );
  });
}

for (const grade of dataGrades) {
  test(`insufficient with ${grade} data grade is internally inconsistent`, () => {
    assert.throws(
      () => evaluateRuleBoundary({ contentGrade: 'A', dataGrade: grade, dataSufficiency: 'insufficient' }),
      RuleEngineInputError,
    );
  });
}

test('rule-engine-v1 table covers all nine sufficient grade groups', () => {
  assert.deepEqual(Object.keys(RULE_ENGINE_V1_RULES).sort(), Object.keys(expectedByGroup).sort());
});

test('all machine rule codes are unique and complete', () => {
  const actual = ['R00_DATA_INSUFFICIENT', ...Object.values(RULE_ENGINE_V1_RULES).map((rule) => rule.ruleCode)];
  assert.equal(new Set(actual).size, 10);
  assert.deepEqual([...new Set(actual)].sort(), [...ruleCodes].sort());
});

test('all rule results belong to the shared allowed set', () => {
  for (const rule of Object.values(RULE_ENGINE_V1_RULES)) assert.ok(ruleResults.includes(rule.ruleResult));
});

test('all recommended boundaries belong to the shared allowed set', () => {
  for (const rule of Object.values(RULE_ENGINE_V1_RULES)) {
    assert.ok(recommendedBoundaries.includes(rule.recommendedBoundary));
  }
});

test('R23 reason never describes B content as excellent', () => {
  const result = evaluateRuleBoundary({ contentGrade: 'B', dataGrade: 'D', dataSufficiency: 'sufficient' });
  assert.match(result.ruleReason, /可接受但不优秀/);
  assert.doesNotMatch(result.ruleReason, /内容优秀/);
});

test('R32 reason requires final evaluation and owner confirmation', () => {
  const result = evaluateRuleBoundary({ contentGrade: 'C', dataGrade: 'B', dataSufficiency: 'sufficient' });
  assert.match(result.ruleReason, /最终评定和负责人确认/);
});

test('rule reasons are bounded deterministic templates without performance conclusions', () => {
  for (const contentGrade of contentGrades) {
    for (const dataGrade of dataGrades) {
      const reason = evaluateRuleBoundary({ contentGrade, dataGrade, dataSufficiency: 'sufficient' }).ruleReason;
      assert.ok(reason.length < 300);
      assert.doesNotMatch(reason, /绩效|最终有效|已确认/);
    }
  }
});
