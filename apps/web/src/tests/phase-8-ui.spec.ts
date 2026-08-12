import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
  canConfirmFinalEvaluation,
  finalConfirmationValidation,
  submitCaseMarking,
  submitFinalConfirmation,
} from '../lib/final-confirmation-ui';

const user = (role: string) => ({ id: 'user', name: role, account: role, role });
const evaluation = { id: 'evaluation', status: 'succeeded', confirmedAt: null } as any;

for (const role of ['admin', 'content_owner', 'supervisor', 'director', 'operator', 'advertiser']) {
  test(`${role} final confirmation control visibility`, () => {
    assert.equal(canConfirmFinalEvaluation(user(role), 'pending_final_confirmation', evaluation), ['admin', 'content_owner'].includes(role));
  });
}

for (const status of ['pending_final_confirmation', 'pending_final_evaluation', 'final_effective', 'final_low_effective', 'final_invalid']) {
  test(`${status} confirmation state`, () => {
    assert.equal(canConfirmFinalEvaluation(user('admin'), status, evaluation), status === 'pending_final_confirmation');
  });
}

test('already confirmed evaluation hides confirmation control', () => {
  assert.equal(canConfirmFinalEvaluation(user('admin'), 'pending_final_confirmation', { ...evaluation, confirmedAt: new Date().toISOString() }), false);
});

for (const [boundary, grade, expected] of [
  ['allow_final_effective', 'effective', null], ['allow_final_effective', 'invalid', '边界'],
  ['allow_final_effective_or_low_effective', 'low_effective', null],
  ['allow_final_low_effective_or_invalid', 'effective', '边界'],
  ['require_final_invalid', 'invalid', null], ['pending_data', 'invalid', '边界'],
] as const) {
  test(`${boundary} frontend validation for ${grade}`, () => {
    const value = finalConfirmationValidation({ boundary, finalGrade: grade, recommendedFinalGrade: grade, canBeUsedForPerformance: false, confirmationComment: '', manualAdjustReason: '' });
    expected ? assert.match(value || '', new RegExp(expected)) : assert.equal(value, null);
  });
}

test('frontend requires adjustment reason', () => {
  assert.match(finalConfirmationValidation({ boundary: 'allow_final_effective_or_low_effective', finalGrade: 'low_effective', recommendedFinalGrade: 'effective', canBeUsedForPerformance: false, confirmationComment: '', manualAdjustReason: '' }) || '', /调整原因/);
});

test('frontend requires manual boundary confirmation comment', () => {
  assert.match(finalConfirmationValidation({ boundary: 'require_manual_confirmation', finalGrade: 'effective', recommendedFinalGrade: 'effective', canBeUsedForPerformance: false, confirmationComment: '', manualAdjustReason: '' }) || '', /人工确认说明/);
});

test('frontend prevents invalid performance reference', () => {
  assert.match(finalConfirmationValidation({ boundary: 'require_final_invalid', finalGrade: 'invalid', recommendedFinalGrade: 'invalid', canBeUsedForPerformance: true, confirmationComment: '', manualAdjustReason: '' }) || '', /绩效/);
});

test('confirmation payload contains no derived formal status', async () => {
  let body: any;
  await submitFinalConfirmation(async (_path, init) => { body = JSON.parse(String(init.body)); return {}; }, 'video', { evaluationId: 'evaluation', finalGrade: 'effective', canBeUsedForPerformance: true });
  assert.deepEqual(body, { evaluationId: 'evaluation', finalGrade: 'effective', canBeUsedForPerformance: true });
  assert.equal('finalStatus' in body, false); assert.equal('isEffectiveFinal' in body, false);
});

for (const caseType of ['excellent', 'negative', 'none'] as const) {
  test(`${caseType} case payload is explicit`, async () => {
    let path = ''; let body: any;
    await submitCaseMarking(async (value, init) => { path = value; body = JSON.parse(String(init.body)); return {}; }, 'video', { evaluationId: 'evaluation', caseType, reason: 'reason' });
    assert.equal(path, '/api/videos/video/case-marking'); assert.equal(body.caseType, caseType);
  });
}

for (const [file, patterns] of [
  ['../components/final-confirmation-panel.tsx', ['最终确认不可撤销', '绩效参考资格仅表示', 'case-marking']],
  ['../../app/dashboard/page.tsx', ['已确认', '流程积压', 'GPT 建议一致率']],
  ['../components/case-library-page.tsx', ['已完成负责人确认', '案例列表暂时不可用']],
] as const) {
  test(`${file} contains required Phase 8 messaging`, async () => {
    const source = await readFile(resolve(__dirname, file), 'utf8');
    for (const pattern of patterns) assert.match(source, new RegExp(pattern));
    assert.doesNotMatch(source, /rawResponse/);
  });
}

test('video detail orders formal confirmation after GPT suggestion', async () => {
  const source = await readFile(resolve(__dirname, '../../app/videos/[id]/page.tsx'), 'utf8');
  assert.ok(source.indexOf('<FinalConfirmationPanel') > source.indexOf('<FinalEvaluationPanel'));
});

test('navigation exposes dashboard and both case libraries', async () => {
  const source = await readFile(resolve(__dirname, '../../app/layout.tsx'), 'utf8');
  for (const href of ['/dashboard', '/cases/excellent', '/cases/negative']) assert.match(source, new RegExp(href));
});
