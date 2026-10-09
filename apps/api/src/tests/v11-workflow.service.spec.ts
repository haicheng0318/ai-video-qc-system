import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UserRole } from '@prisma/client';
import { V11WorkflowService } from '../modules/v11/v11-workflow.service';

test('appeal supersedes the prior workflow, group and active runs before queuing a blind rerun', async () => {
  const calls: Array<{ name: string; args: any }> = [];
  const workflow = { id: 'workflow-old', revision: 2, status: 'current' };
  const group = { id: 'group-old', videoId: 'video-1', inputRevisionId: 'input-1', shadowMode: false };
  const tx: any = {
    $queryRaw: async () => [],
    v11EvaluationDecision: { findUnique: async () => ({ id: 'decision-1', groupId: group.id, workflowRevisionId: workflow.id, group, workflowRevision: workflow }) },
    v11Appeal: {
      findFirst: async () => null,
      create: async ({ data }: any) => ({ id: 'appeal-1', status: 'active', ...data }),
    },
    v11WorkflowRevision: {
      update: async (args: any) => { calls.push({ name: 'workflow.update', args }); return workflow; },
      create: async ({ data }: any) => ({ id: 'workflow-new', ...data }),
    },
    v11EvaluationRun: {
      updateMany: async (args: any) => { calls.push({ name: 'run.updateMany', args }); return { count: 1 }; },
      findFirstOrThrow: async () => ({ blindContextHash: 'blind-hash', modelProvider: 'aliyun_bailian', modelName: 'qwen', modelConfigSnapshot: {}, promptVersion: 'p1', schemaVersion: 's1', rubricVersion: 'r1', ratingVersion: 'rt1', preprocessingVersion: 'pre1', referenceSetVersion: 'ref1' }),
      create: async ({ data }: any) => ({ id: 'run-new', ...data }),
    },
    v11EvaluationGroup: {
      updateMany: async (args: any) => { calls.push({ name: 'group.updateMany', args }); return { count: 1 }; },
      create: async ({ data }: any) => ({ id: 'group-new', ...data }),
    },
    v11WorkflowHold: { create: async ({ data }: any) => ({ id: 'hold-1', ...data }) },
    operationLog: { create: async () => ({ id: 'log-1' }) },
  };
  const db: any = { $transaction: async (action: (client: any) => unknown) => action(tx) };
  const permissions: any = { findVideoVisibleToUser: async () => ({ id: 'video-1', creatorId: 'owner-1' }) };
  let queued: any;
  const jobs: any = { enqueue: async (_tx: any, input: any) => { queued = input; return { id: 'job-1' }; } };
  const service = new V11WorkflowService(db, permissions, jobs);
  const user = { id: 'owner-1', role: UserRole.director } as any;

  const result = await service.appeal('video-1', { stage: 'content', resultId: 'decision-1', reason: '画面中的产品露出事实与我的观察不一致' } as any, user);

  assert.equal(result.workflowRevision, 3);
  assert.equal(result.groupId, 'group-new');
  assert.equal(calls.find((call) => call.name === 'workflow.update')?.args.data.status, 'superseded');
  assert.equal(calls.find((call) => call.name === 'run.updateMany')?.args.data.status, 'stale');
  assert.equal(calls.find((call) => call.name === 'group.updateMany')?.args.data.status, 'superseded');
  assert.equal(queued.inputRefs.workflowRevisionId, 'workflow-new');
  assert.equal(queued.inputRefs.inputRevisionId, 'input-1');
});
