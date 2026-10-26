import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { UserRole, VideoStatus } from '@prisma/client';
import { confirmComprehensiveSchema } from '../modules/v11/benchmark-schema';
import { V11RatingsService } from '../modules/v11/v11-ratings.service';

const ids = {
  video: '10000000-0000-4000-8000-000000000001',
  workflow: '10000000-0000-4000-8000-000000000002',
  content: '10000000-0000-4000-8000-000000000003',
  data: '10000000-0000-4000-8000-000000000004',
  decision: '10000000-0000-4000-8000-000000000005',
  created: '10000000-0000-4000-8000-000000000006',
  user: '10000000-0000-4000-8000-000000000007',
  metric: '10000000-0000-4000-8000-000000000008',
};

function createHarness(overrides: {
  rating?: string;
  latestId?: string;
  latestMetricId?: string;
  holds?: number;
  appeals?: number;
  shadowMode?: boolean;
  inputComplete?: boolean;
  stable?: boolean;
  complianceStatus?: string;
  dataSufficiency?: string;
  dataRating?: string | null;
  workflowStatus?: string;
  requiresAdminReview?: boolean;
  manualFinalConfirmationEnabled?: boolean;
} = {}) {
  const calls: Array<{ name: string; data: any }> = [];
  const previous = {
    id: overrides.latestId ?? ids.decision,
    videoId: ids.video,
    workflowRevisionId: ids.workflow,
    contentDecisionId: ids.content,
    dataDecisionId: ids.data,
    decisionRevision: 1,
    comprehensiveRating: overrides.rating ?? 'A',
    matrixVersion: 'comprehensive-matrix-v1.1-r1',
    requiresAdminReview: overrides.requiresAdminReview ?? false,
    businessConclusion: null,
    finalStatus: null,
    isEffectiveFinal: null,
    workflowRevision: { status: overrides.workflowStatus ?? 'current' },
    contentDecision: {
      inputComplete: overrides.inputComplete ?? true,
      stable: overrides.stable ?? true,
      complianceStatus: overrides.complianceStatus ?? 'clear',
      group: { shadowMode: overrides.shadowMode ?? false },
    },
    dataDecision: {
      dataSufficiency: overrides.dataSufficiency ?? 'sufficient',
      dataRating: overrides.dataRating === undefined ? 'A' : overrides.dataRating,
      resultMetricId: ids.metric,
    },
  };
  const tx: any = {
    $queryRaw: async () => [],
    video: {
      findUnique: async () => ({ id: ids.video, recordState: 'active' }),
      update: async ({ data }: any) => { calls.push({ name: 'video.update', data }); return { id: ids.video, ...data }; },
    },
    v11ComprehensiveDecision: {
      findFirst: async (args: any) => { calls.push({ name: 'decision.findFirst', data: args }); return previous; },
      create: async ({ data }: any) => { calls.push({ name: 'decision.create', data }); return { id: ids.created, ...data }; },
    },
    v11WorkflowHold: { count: async () => overrides.holds ?? 0 },
    v11Appeal: { count: async () => overrides.appeals ?? 0 },
    videoResultMetric: {
      findFirst: async () => ({ id: overrides.latestMetricId ?? ids.metric }),
    },
    v11WorkflowGateDecision: {
      create: async ({ data }: any) => { calls.push({ name: 'gate.create', data }); return { id: 'gate-1', ...data }; },
    },
    runtimeSetting: {
      findUnique: async () => ({ value: {
        manualContentReviewEnabled: true,
        manualFinalConfirmationEnabled: overrides.manualFinalConfirmationEnabled ?? true,
      } }),
    },
  };
  const db: any = { $transaction: async (action: (client: any) => unknown) => action(tx) };
  const logs: any = {
    create: async (data: any) => { calls.push({ name: 'log.create', data }); return { id: 'log-1' }; },
  };
  const service = new V11RatingsService(db, { assertVideoActive: () => undefined } as any, logs);
  const user = { id: ids.user, role: UserRole.admin } as any;
  return { service, user, calls };
}

function createShadowPipelineHarness(options: { shadowMode?: boolean; latestMetricId?: string } = {}) {
  const calls: Array<{ name: string; data: any }> = [];
  let dataDecision: any = null;
  let currentMetricId = options.latestMetricId ?? ids.metric;
  const video = {
    id: ids.video,
    status: VideoStatus.approved_for_publish,
    platform: 'douyin',
    brand: 'Brand',
    videoType: 'organic',
  };
  const content = {
    id: ids.content,
    inputComplete: true,
    stable: true,
    complianceStatus: 'clear',
    contentRating: 'A',
    group: { shadowMode: options.shadowMode ?? true },
  };
  const metric = {
    id: ids.metric,
    videoId: ids.video,
    videoType: 'organic',
    submittedBy: ids.user,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    dataStartDate: new Date('2026-10-01T00:00:00Z'),
    dataEndDate: new Date('2026-10-01T00:00:00Z'),
    views: 850,
  };
  const workflow = { id: ids.workflow, activeContentDecisionId: ids.content };
  const tx: any = {
    $queryRaw: async () => [],
    video: {
      findUnique: async () => video,
      update: async ({ data }: any) => { calls.push({ name: 'video.update', data }); return { ...video, ...data }; },
    },
    v11WorkflowRevision: { findFirst: async () => workflow },
    v11EvaluationDecision: { findUnique: async () => content },
    videoResultMetric: { findFirst: async () => ({ ...metric, id: currentMetricId }) },
    v11DataRatingDecision: {
      findUnique: async () => null,
      findFirst: async () => dataDecision,
      create: async ({ data }: any) => {
        dataDecision = { id: ids.data, decidedAt: new Date(), ...data };
        calls.push({ name: 'data.create', data });
        return dataDecision;
      },
    },
    v11BenchmarkProfile: {
      findFirst: async () => ({
        id: 'profile-1',
        primaryMetric: 'views',
        requiredMetrics: ['views'],
        minimumSampleMetric: 'views',
        minimumSampleValue: 1,
        observationWindowDays: 1,
        guardRules: [],
        thresholds: [{
          metricName: 'views', direction: 'higher_better', sThreshold: 1000, aPlusThreshold: 900,
          aThreshold: 800, bThreshold: 700, bMinusThreshold: 600, cThreshold: 500,
        }],
      }),
    },
    aiResultReview: { findFirst: async () => null },
    v11ComprehensiveDecision: {
      findFirst: async () => null,
      create: async ({ data }: any) => {
        calls.push({ name: 'decision.create', data });
        return { id: ids.decision, ...data };
      },
    },
    v11WorkflowHold: { count: async () => 0 },
    v11Appeal: { count: async () => 0 },
    v11WorkflowGateDecision: {
      create: async ({ data }: any) => { calls.push({ name: 'gate.create', data }); return { id: 'gate-1', ...data }; },
    },
    runtimeSetting: {
      findUnique: async () => ({ value: { manualContentReviewEnabled: false, manualFinalConfirmationEnabled: false } }),
    },
  };
  const db: any = {
    $transaction: async (action: (client: any) => unknown) => action(tx),
  };
  const permissions: any = {
    findVideoVisibleToUser: async () => video,
    assertVideoActive: () => undefined,
    assertDataStageOpen: async () => undefined,
  };
  const logs: any = { create: async (data: any) => { calls.push({ name: 'log.create', data }); return { id: 'log-1' }; } };
  return {
    service: new V11RatingsService(db, permissions, logs),
    user: { id: ids.user, role: UserRole.admin } as any,
    calls,
    setLatestMetricId: (id: string) => { currentMetricId = id; },
  };
}

test('final confirmation validates a current decision id and a meaningful reason', async () => {
  assert.equal(confirmComprehensiveSchema.safeParse({ decisionId: ids.decision, reason: '确认该结果符合现有证据。' }).success, true);
  assert.equal(confirmComprehensiveSchema.safeParse({ decisionId: ids.decision, reason: '太短' }).success, false);
  const { service, user } = createHarness({ latestId: '10000000-0000-4000-8000-000000000099' });
  await assert.rejects(
    () => service.confirmComprehensive(ids.video, { decisionId: ids.decision, reason: '确认该结果符合现有证据。' }, user),
    (error: unknown) => error instanceof ConflictException,
  );
  await assert.rejects(
    () => service.confirmComprehensive(ids.video, { decisionId: 'bad', reason: '确认该结果符合现有证据。' }, user),
    (error: unknown) => error instanceof BadRequestException,
  );
});

test('human final confirmation persists the immutable decision, gate, video status and audit log together', async () => {
  const { service, user, calls } = createHarness({ rating: 'A' });
  const result = await service.confirmComprehensive(ids.video, {
    decisionId: ids.decision,
    reason: '证据完整，确认采用当前综合等级。',
    performanceEligible: true,
  }, user);

  assert.equal(result.finalStatus, 'final_effective');
  assert.equal(result.performanceEligible, true);
  assert.equal(calls.find((call) => call.name === 'decision.create')?.data.comprehensiveRating, 'A');
  assert.equal(calls.find((call) => call.name === 'decision.findFirst')?.data.where.workflowRevision.status, 'current');
  assert.equal(calls.find((call) => call.name === 'video.update')?.data.status, VideoStatus.final_effective);
  assert.equal(calls.find((call) => call.name === 'gate.create')?.data.decisionSource, 'human');
  assert.equal(calls.find((call) => call.name === 'log.create')?.data.actionType, 'v11_comprehensive_final_confirmed');
});

test('invalid decisions cannot become performance eligible and active safety gates block confirmation', async () => {
  const invalid = createHarness({ rating: 'D' });
  const result = await invalid.service.confirmComprehensive(ids.video, {
    decisionId: ids.decision,
    reason: '证据完整，确认该结果为无效。',
    performanceEligible: true,
  }, invalid.user);
  assert.equal(result.finalStatus, 'final_invalid');
  assert.equal(result.performanceEligible, false);

  const blocked = createHarness({ holds: 1 });
  await assert.rejects(
    () => blocked.service.confirmComprehensive(ids.video, { decisionId: ids.decision, reason: '仍有挂起事项，不应完成确认。' }, blocked.user),
    (error: unknown) => error instanceof ConflictException,
  );
  assert.equal(blocked.calls.some((call) => call.name === 'decision.create'), false);
});

test('final confirmation rejects shadow, stale metric and unsafe content decisions', async () => {
  for (const harness of [
    createHarness({ shadowMode: true }),
    createHarness({ latestMetricId: '10000000-0000-4000-8000-000000000099' }),
    createHarness({ inputComplete: false }),
    createHarness({ stable: false }),
    createHarness({ complianceStatus: 'suspected' }),
    createHarness({ appeals: 1 }),
  ]) {
    await assert.rejects(
      () => harness.service.confirmComprehensive(ids.video, {
        decisionId: ids.decision,
        reason: '安全门未通过时不得完成正式确认。',
      }, harness.user),
      (error: unknown) => error instanceof ConflictException,
    );
    assert.equal(harness.calls.some((call) => call.name === 'decision.create'), false);
  }
});

test('administrator R resolution revalidates safety before automatic finalization', async () => {
  const unsafe = createHarness({ requiresAdminReview: true, complianceStatus: 'suspected', manualFinalConfirmationEnabled: false });
  await assert.rejects(
    () => unsafe.service.resolveManualComprehensive(ids.video, {
      rating: 'A',
      reason: '管理员人工选择等级，但仍需遵守安全门。',
    }, unsafe.user),
    (error: unknown) => error instanceof ConflictException,
  );
  assert.equal(unsafe.calls.some((call) => call.name === 'decision.create'), false);

  const safe = createHarness({ requiresAdminReview: true, manualFinalConfirmationEnabled: false });
  const result = await safe.service.resolveManualComprehensive(ids.video, {
    rating: 'A',
    reason: '证据完整且安全门通过，允许自动形成正式结论。',
  }, safe.user);
  assert.equal(result.finalStatus, 'final_effective');
  assert.equal(safe.calls.find((call) => call.name === 'gate.create')?.data.decisionSource, 'system');
});

test('shadow content can produce comparison ratings without changing formal video state or final gate', async () => {
  const harness = createShadowPipelineHarness();
  const data = await harness.service.rateData(ids.video, harness.user);
  assert.equal(data.dataRating, 'A');
  const comprehensive = await harness.service.createComprehensiveDecision(ids.video, harness.user);
  assert.equal(comprehensive.comprehensiveRating, 'A');
  assert.equal(comprehensive.finalStatus, null);
  assert.equal(comprehensive.performanceEligible, false);
  assert.equal(harness.calls.some((call) => call.name === 'video.update'), false);
  assert.equal(harness.calls.some((call) => call.name === 'gate.create'), false);
  assert.equal(harness.calls.find((call) => call.name === 'decision.create')?.data.explanation.shadowMode, true);
});

test('a newer immutable result metric blocks comprehensive rating based on a stale data decision', async () => {
  const harness = createShadowPipelineHarness({ shadowMode: false });
  await harness.service.rateData(ids.video, harness.user);
  harness.setLatestMetricId('10000000-0000-4000-8000-000000000099');
  await assert.rejects(
    () => harness.service.createComprehensiveDecision(ids.video, harness.user),
    (error: unknown) => error instanceof ConflictException,
  );
  assert.equal(harness.calls.some((call) => call.name === 'decision.create'), false);
});

test('case library reads only current decisions without active holds or appeals', async () => {
  let where: any;
  const db: any = { v11ComprehensiveDecision: { findMany: async (args: any) => { where = args.where; return []; } } };
  const permissions: any = { buildVideoVisibilityWhere: () => ({ creatorId: ids.user }), assertVideoActive: () => undefined };
  const service = new V11RatingsService(db, permissions, {} as any);
  const result = await service.listCases('excellent', { id: ids.user, role: UserRole.director } as any);
  assert.deepEqual(result.items, []);
  assert.equal(where.workflowRevision.status, 'current');
  assert.deepEqual(where.workflowRevision.holds, { none: { status: 'active' } });
  assert.deepEqual(where.workflowRevision.appeals, { none: { status: 'active' } });
  assert.deepEqual(where.contentDecision, { group: { shadowMode: false } });
});

test('a superseded decision cannot be newly marked as a case', async () => {
  const tx: any = {
    $queryRaw: async () => [],
    video: { findUnique: async () => ({ recordState: 'active' }) },
    v11ComprehensiveDecision: {
      findUnique: async () => ({
        id: ids.decision,
        videoId: ids.video,
        finalStatus: 'final_effective',
        comprehensiveRating: 'A',
        workflowRevision: { id: ids.workflow, status: 'superseded' },
      }),
      update: async () => { throw new Error('must not update'); },
    },
    v11WorkflowHold: { count: async () => 0 },
    v11Appeal: { count: async () => 0 },
  };
  const service = new V11RatingsService({ $transaction: async (action: any) => action(tx) } as any, { assertVideoActive: () => undefined } as any, {} as any);
  await assert.rejects(
    () => service.markCase(ids.decision, { type: 'excellent', note: '可复用的高质量样本' }, { id: ids.user, role: UserRole.admin } as any),
    (error: unknown) => error instanceof ConflictException,
  );
});
