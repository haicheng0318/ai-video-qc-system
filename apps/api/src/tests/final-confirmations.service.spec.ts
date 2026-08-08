import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AiReviewStatus, DataSufficiency, VideoStatus } from '@prisma/client';
import { FinalConfirmationsService } from '../modules/final-confirmations/final-confirmations.service';

const user = { id: '11111111-1111-4111-8111-111111111111', role: 'content_owner', account: 'owner', name: 'Owner', managerId: null } as any;
const videoId = '22222222-2222-4222-8222-222222222222';

function harness(overrides: Record<string, any> = {}) {
  const updates: any[] = [];
  const logs: any[] = [];
  const video = { id: 'video', status: VideoStatus.pending_final_confirmation };
  const evaluation = {
    id: 'evaluation', videoId: 'video', contentReviewId: 'content', resultReviewId: 'result', ruleEngineResultId: 'rule',
    status: AiReviewStatus.succeeded, contentGrade: 'A', dataGrade: 'A', recommendedFinalGrade: 'effective',
    confirmedAt: null, confirmedBy: null, finalGrade: null, finalStatus: null, isEffectiveFinal: null,
    canBeUsedForPerformance: false,
  };
  const rule = {
    id: 'rule', videoId: 'video', contentReviewId: 'content', resultReviewId: 'result', ruleVersion: 'rule-engine-v1',
    contentGrade: 'A', dataGrade: 'A', dataSufficiency: DataSufficiency.sufficient,
    ruleCode: 'R11_CONTENT_HIGH_DATA_HIGH', ruleResult: 'excellent_effective_candidate',
    recommendedBoundary: 'allow_final_effective',
  };
  Object.assign(video, overrides.video || {}); Object.assign(evaluation, overrides.evaluation || {}); Object.assign(rule, overrides.rule || {});
  const content = { id: 'content', videoId: 'video', status: AiReviewStatus.succeeded, contentGrade: rule.contentGrade, ...(overrides.content || {}) };
  const result = { id: 'result', videoId: 'video', status: AiReviewStatus.succeeded, resultMetricId: 'metric', dataGrade: rule.dataGrade, dataSufficiency: rule.dataSufficiency, ...(overrides.result || {}) };
  const metric = { id: 'metric', videoId: 'video', ...(overrides.metric || {}) };
  const tx: any = {
    $queryRaw: async () => [{ id: 'video' }],
    video: {
      findUnique: async () => overrides.missingVideo ? null : video,
      update: async (args: any) => { updates.push({ model: 'video', ...args }); return { ...video, ...args.data }; },
    },
    finalVideoEvaluation: {
      findFirst: async (args: any) => args.where?.id
        ? (overrides.missingEvaluation ? null : evaluation)
        : { id: overrides.latestEvaluationId || evaluation.id },
      update: async (args: any) => {
        updates.push({ model: 'evaluation', ...args });
        return { ...evaluation, ...args.data, confirmer: { id: user.id, name: user.name, account: user.account, role: user.role } };
      },
    },
    ruleEngineResult: { findFirst: async (args: any) => args.where?.id ? (overrides.missingRule ? null : rule) : { ...rule, id: overrides.latestRuleId || rule.id } },
    aiContentReview: { findFirst: async () => overrides.missingContent ? null : content },
    aiResultReview: { findFirst: async (args: any) => args.where?.id ? (overrides.missingResult ? null : result) : { ...result, id: overrides.latestResultId || result.id } },
    videoResultMetric: { findFirst: async (args: any) => args.where?.id ? (overrides.missingMetric ? null : metric) : { ...metric, id: overrides.latestMetricId || metric.id } },
    supervisorReview: { findUnique: async () => overrides.missingSupervisor ? null : { decision: VideoStatus.approved_for_publish, isAllowedToPublish: true, ...(overrides.supervisor || {}) } },
  };
  const prisma: any = {
    video: { findUnique: async () => overrides.outerMissingVideo ? null : video },
    $transaction: async (callback: any) => callback(tx),
  };
  const permissions = { assertCanConfirmFinalEvaluation: async () => undefined } as any;
  const operationLogs = { create: async (value: any, client: any) => { logs.push(value); assert.equal(client, tx); } } as any;
  return { service: new FinalConfirmationsService(prisma, permissions, operationLogs), updates, logs, evaluation, rule, video };
}

const allowed = [
  ['allow_final_effective', 'effective', 'A', 'A'],
  ['allow_final_effective_or_low_effective', 'effective', 'B', 'A'],
  ['allow_final_effective_or_low_effective', 'low_effective', 'B', 'A'],
  ['allow_final_low_effective_or_invalid', 'low_effective', 'A', 'C'],
  ['allow_final_low_effective_or_invalid', 'invalid', 'A', 'C'],
  ['require_manual_confirmation', 'effective', 'C', 'A'],
  ['require_manual_confirmation', 'low_effective', 'C', 'A'],
  ['require_manual_confirmation', 'invalid', 'C', 'A'],
  ['require_final_invalid', 'invalid', 'C', 'C'],
] as const;

function ruleShape(content: string, data: string) {
  const groups = content === 'B' ? 'mid' : ['C', 'D'].includes(content) ? 'low' : 'high';
  const dataGroup = data === 'B' ? 'mid' : ['C', 'D'].includes(data) ? 'low' : 'high';
  const map: any = {
    high_high: ['R11_CONTENT_HIGH_DATA_HIGH', 'excellent_effective_candidate'], high_low: ['R13_CONTENT_HIGH_DATA_LOW', 'content_good_result_poor'],
    mid_high: ['R21_CONTENT_MID_DATA_HIGH', 'potential_effective_candidate'], low_high: ['R31_CONTENT_LOW_DATA_HIGH', 'abnormal_need_confirmation'],
    low_low: ['R33_CONTENT_LOW_DATA_LOW', 'invalid_candidate'],
  };
  return map[`${groups}_${dataGroup}`];
}

for (const [boundary, grade, contentGrade, dataGrade] of allowed) {
  test(`${boundary} accepts ${grade}`, async () => {
    const [ruleCode, ruleResult] = ruleShape(contentGrade, dataGrade);
    const value = harness({ rule: { recommendedBoundary: boundary, contentGrade, dataGrade, ruleCode, ruleResult }, evaluation: { contentGrade, dataGrade, recommendedFinalGrade: grade } });
    const response = await value.service.confirm(videoId, { evaluationId: 'evaluation', finalGrade: grade, canBeUsedForPerformance: false, ...(boundary === 'require_manual_confirmation' ? { confirmationComment: '人工复核依据完整明确' } : {}) }, user, {});
    assert.equal(response.finalGrade, grade); assert.equal(value.updates.filter((item) => item.model === 'video').length, 1);
    assert.equal(value.logs[0].actionType, 'final_evaluation_confirmed');
  });
}

for (const [boundary, grade] of [
  ['allow_final_effective', 'invalid'], ['allow_final_effective', 'low_effective'],
  ['allow_final_effective_or_low_effective', 'invalid'], ['allow_final_low_effective_or_invalid', 'effective'],
  ['require_final_invalid', 'effective'], ['require_final_invalid', 'low_effective'], ['pending_data', 'invalid'],
] as const) {
  test(`${boundary} rejects ${grade}`, async () => {
    const value = harness({ rule: { recommendedBoundary: boundary } });
    await assert.rejects(value.service.confirm(videoId, { evaluationId: 'evaluation', finalGrade: grade, canBeUsedForPerformance: false }, user, {}));
    assert.equal(value.updates.length, 0);
  });
}

for (const [name, overrides] of [
  ['wrong video status', { video: { status: VideoStatus.final_effective } }],
  ['non-latest evaluation', { latestEvaluationId: 'other' }],
  ['already confirmed', { evaluation: { confirmedAt: new Date() } }],
  ['missing rule', { missingRule: true }],
  ['non-latest rule', { latestRuleId: 'other' }],
  ['missing content', { missingContent: true }],
  ['missing result', { missingResult: true }],
  ['non-latest result', { latestResultId: 'other' }],
  ['missing metric', { missingMetric: true }],
  ['non-latest metric', { latestMetricId: 'other' }],
  ['missing supervisor', { missingSupervisor: true }],
  ['failed content', { content: { status: AiReviewStatus.failed } }],
  ['failed result', { result: { status: AiReviewStatus.failed } }],
] as const) {
  test(`${name} blocks formal confirmation`, async () => {
    const value = harness(overrides as any);
    await assert.rejects(value.service.confirm(videoId, { evaluationId: 'evaluation', finalGrade: 'effective', canBeUsedForPerformance: false }, user, {}));
  });
}

test('adjusting GPT recommendation requires a meaningful reason and writes a second log', async () => {
  const value = harness({
    rule: { recommendedBoundary: 'allow_final_effective_or_low_effective', contentGrade: 'B', ruleCode: 'R21_CONTENT_MID_DATA_HIGH', ruleResult: 'potential_effective_candidate' },
    evaluation: { contentGrade: 'B' },
  });
  await assert.rejects(value.service.confirm(videoId, { evaluationId: 'evaluation', finalGrade: 'low_effective', canBeUsedForPerformance: false, manualAdjustReason: '太短' }, user, {}));
  await value.service.confirm(videoId, { evaluationId: 'evaluation', finalGrade: 'low_effective', canBeUsedForPerformance: false, manualAdjustReason: '基于业务复核证据调整等级' }, user, {});
  assert.deepEqual(value.logs.map((log) => log.actionType), ['final_evaluation_confirmed', 'final_grade_adjusted']);
});

test('accepting GPT recommendation rejects adjustment reason', async () => {
  const value = harness();
  await assert.rejects(value.service.confirm(videoId, { evaluationId: 'evaluation', finalGrade: 'effective', canBeUsedForPerformance: false, manualAdjustReason: '不应保存这个调整理由' }, user, {}));
});

test('manual confirmation boundary requires a comment', async () => {
  const value = harness({ rule: { recommendedBoundary: 'require_manual_confirmation', contentGrade: 'C', ruleCode: 'R31_CONTENT_LOW_DATA_HIGH', ruleResult: 'abnormal_need_confirmation' }, evaluation: { contentGrade: 'C' }, content: { contentGrade: 'C' } });
  await assert.rejects(value.service.confirm(videoId, { evaluationId: 'evaluation', finalGrade: 'effective', canBeUsedForPerformance: false }, user, {}));
});

test('invalid final grade cannot be performance eligible', async () => {
  const value = harness({ rule: { recommendedBoundary: 'allow_final_low_effective_or_invalid', dataGrade: 'C', ruleCode: 'R13_CONTENT_HIGH_DATA_LOW', ruleResult: 'content_good_result_poor' }, evaluation: { dataGrade: 'C', recommendedFinalGrade: 'invalid' }, result: { dataGrade: 'C' } });
  await assert.rejects(value.service.confirm(videoId, { evaluationId: 'evaluation', finalGrade: 'invalid', canBeUsedForPerformance: true }, user, {}));
});

for (const field of ['confirmationComment', 'manualAdjustReason'] as const) {
  test(`${field} rejects HTML`, async () => {
    const value = harness();
    await assert.rejects(value.service.confirm(videoId, { evaluationId: 'evaluation', finalGrade: 'effective', canBeUsedForPerformance: false, [field]: '<script>alert(1)</script>' }, user, {}));
  });
}
