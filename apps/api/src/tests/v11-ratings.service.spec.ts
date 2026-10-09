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
};

function createHarness(overrides: { rating?: string; latestId?: string; holds?: number; appeals?: number } = {}) {
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
    requiresAdminReview: false,
    businessConclusion: null,
    finalStatus: null,
    isEffectiveFinal: null,
  };
  const tx: any = {
    $queryRaw: async () => [],
    video: {
      findUnique: async () => ({ id: ids.video }),
      update: async ({ data }: any) => { calls.push({ name: 'video.update', data }); return { id: ids.video, ...data }; },
    },
    v11ComprehensiveDecision: {
      findFirst: async (args: any) => { calls.push({ name: 'decision.findFirst', data: args }); return previous; },
      create: async ({ data }: any) => { calls.push({ name: 'decision.create', data }); return { id: ids.created, ...data }; },
    },
    v11WorkflowHold: { count: async () => overrides.holds ?? 0 },
    v11Appeal: { count: async () => overrides.appeals ?? 0 },
    v11WorkflowGateDecision: {
      create: async ({ data }: any) => { calls.push({ name: 'gate.create', data }); return { id: 'gate-1', ...data }; },
    },
    runtimeSetting: {
      findUnique: async () => ({ value: { manualContentReviewEnabled: true, manualFinalConfirmationEnabled: true } }),
    },
  };
  const db: any = { $transaction: async (action: (client: any) => unknown) => action(tx) };
  const logs: any = {
    create: async (data: any) => { calls.push({ name: 'log.create', data }); return { id: 'log-1' }; },
  };
  const service = new V11RatingsService(db, {} as any, logs);
  const user = { id: ids.user, role: UserRole.admin } as any;
  return { service, user, calls };
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

test('case library reads only current decisions without active holds or appeals', async () => {
  let where: any;
  const db: any = { v11ComprehensiveDecision: { findMany: async (args: any) => { where = args.where; return []; } } };
  const permissions: any = { buildVideoVisibilityWhere: () => ({ creatorId: ids.user }) };
  const service = new V11RatingsService(db, permissions, {} as any);
  const result = await service.listCases('excellent', { id: ids.user, role: UserRole.director } as any);
  assert.deepEqual(result.items, []);
  assert.equal(where.workflowRevision.status, 'current');
  assert.deepEqual(where.workflowRevision.holds, { none: { status: 'active' } });
  assert.deepEqual(where.workflowRevision.appeals, { none: { status: 'active' } });
});

test('a superseded decision cannot be newly marked as a case', async () => {
  const tx: any = {
    $queryRaw: async () => [],
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
  const service = new V11RatingsService({ $transaction: async (action: any) => action(tx) } as any, {} as any, {} as any);
  await assert.rejects(
    () => service.markCase(ids.decision, { type: 'excellent', note: '可复用的高质量样本' }, { id: ids.user, role: UserRole.admin } as any),
    (error: unknown) => error instanceof ConflictException,
  );
});
