import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ConflictException, ForbiddenException, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { UserRole, VideoStatus, VideoType } from '@prisma/client';
import { countQualifiedInitialPilotSamples, V11ContentService } from '../modules/v11/v11-content.service';

const ids = {
  video: '20000000-0000-4000-8000-000000000001',
  owner: '20000000-0000-4000-8000-000000000002',
  admin: '20000000-0000-4000-8000-000000000003',
  workflow: '20000000-0000-4000-8000-000000000004',
};

async function createHarness(options: {
  shadowMode?: boolean;
  workflowShadowMode?: boolean;
  evaluationInstabilityHold?: boolean;
  holdTypes?: string[];
  activeAppeals?: number;
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'v11-pilot-trigger-'));
  const path = join(directory, 'fixture.mp4');
  await writeFile(path, 'same frozen media bytes');
  const groups: any[] = [];
  const inputs: any[] = [];
  const runs: any[] = [];
  const jobs: any[] = [];
  let shadowMode = options.shadowMode ?? true;
  let sequence = 10;
  const id = () => `20000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`;
  const video = {
    id: ids.video,
    title: 'Pilot fixture',
    filePath: 'storage/videos/fixture.mp4',
    fileSizeBytes: BigInt(23),
    duration: null,
    mimeType: 'video/mp4',
    creatorId: ids.owner,
    brand: 'Brand',
    product: 'Product',
    platform: 'douyin',
    videoType: VideoType.organic,
    scriptDescription: null,
    isForAds: false,
    isEventVideo: false,
    eventName: null,
    relatedRequirement: null,
    status: VideoStatus.submitted,
  };
  let workflow: any = {
    id: ids.workflow, videoId: ids.video, ownerId: ids.owner, revision: 1, status: 'current',
    activeContentDecisionId: null,
    policySnapshot: options.workflowShadowMode === undefined ? { shadowMode: options.shadowMode ?? true } : { shadowMode: options.workflowShadowMode },
  };
  const workflows: any[] = [workflow];
  const holdTypes = options.holdTypes ?? (options.evaluationInstabilityHold ? ['evaluation_instability'] : []);
  const holds = holdTypes.map((holdType, index) => ({
    id: `20000000-0000-4000-8000-${String(98 + index).padStart(12, '0')}`,
    workflowRevisionId: workflow.id,
    holdType,
    status: 'active',
  }));
  const appeals = Array.from({ length: options.activeAppeals ?? 0 }, (_, index) => ({
    id: `20000000-0000-4000-8001-${String(index + 1).padStart(12, '0')}`,
    workflowRevisionId: workflow.id,
    status: 'active',
  }));
  const activeDecision = options.workflowShadowMode === undefined || holdTypes.length > 0 || appeals.length > 0 ? null : {
    id: '20000000-0000-4000-8000-000000000099',
    group: { shadowMode: options.workflowShadowMode },
  };
  if (activeDecision) workflow.activeContentDecisionId = activeDecision.id;
  const tx: any = {
    $queryRaw: async () => [],
    v11EvaluationGroup: {
      findFirst: async ({ where }: any) => {
        const group = groups.slice().reverse().find((candidate) => candidate.ownerId === where.ownerId
          && candidate.shadowMode === where.shadowMode
          && candidate.independent === where.independent
          && candidate.pilotRun === where.pilotRun
          && ['queued', 'running', 'review_required', 'adopted'].includes(candidate.status)
          && inputs.find((input) => input.id === candidate.inputRevisionId)?.evaluationFingerprint === where.inputRevision.evaluationFingerprint);
        return group ? { ...group, runs: runs.filter((run) => run.groupId === group.id) } : null;
      },
      create: async ({ data }: any) => {
        const group = { id: id(), status: 'queued', ...data };
        groups.push(group);
        return group;
      },
      updateMany: async () => ({ count: 0 }),
    },
    v11EvaluationInputRevision: {
      findFirst: async () => inputs.at(-1) ?? null,
      create: async ({ data }: any) => {
        const input = { id: id(), ...data };
        inputs.push(input);
        return input;
      },
    },
    v11WorkflowRevision: {
      findFirst: async () => ({
        ...workflow,
        holds: holds.filter((hold) => hold.workflowRevisionId === workflow.id && hold.status === 'active'),
        appeals: appeals.filter((appeal) => appeal.workflowRevisionId === workflow.id && appeal.status === 'active'),
      }),
      update: async ({ data }: any) => { Object.assign(workflow, data); return workflow; },
      create: async ({ data }: any) => {
        workflow = { id: id(), status: 'current', holds: [], appeals: [], ...data };
        workflows.push(workflow);
        return workflow;
      },
    },
    v11EvaluationDecision: {
      findUnique: async () => activeDecision,
    },
    v11EvaluationRun: {
      create: async ({ data }: any) => {
        const run = { id: id(), ...data };
        runs.push(run);
        return run;
      },
      updateMany: async () => ({ count: 0 }),
    },
    video: {
      update: async ({ data }: any) => {
        Object.assign(video, data);
        return video;
      },
    },
  };
  let transactionTail = Promise.resolve();
  const db: any = {
    runtimeSetting: { findUnique: async () => ({ value: { enabled: true, shadowMode } }) },
    video: { findUnique: async () => video },
    aiModelConfig: { findFirst: async () => null },
    $transaction: async (callback: (client: any) => unknown) => {
      const result = transactionTail.then(() => callback(tx));
      transactionTail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  const jobsService: any = {
    enqueue: async (_client: any, data: any) => {
      const job = { id: id(), ...data };
      jobs.push(job);
      return job;
    },
  };
  const service = new V11ContentService(
    db,
    { assertCanTriggerContentReview: async () => undefined } as any,
    { create: async () => ({ id: id() }) } as any,
    { materialize: async () => ({ path, cleanup: async () => undefined }) } as any,
    jobsService,
    { analyzeVideo: async () => { throw new Error('model must not be called by trigger tests'); } } as any,
  );
  return {
    service,
    db,
    groups,
    inputs,
    runs,
    jobs,
    workflows,
    holds,
    appeals,
    setShadowMode: (value: boolean) => { shadowMode = value; },
    getWorkflow: () => workflow,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test('formal V1.1 trigger becomes the authoritative content workflow and marks the video reviewing', async () => {
  const harness = await createHarness({ shadowMode: false });
  try {
    const started = await harness.service.trigger(ids.video, { id: ids.owner, role: UserRole.director } as any, {});
    assert.equal(started.shadowMode, false);
    assert.equal((await harness.db.video.findUnique()).status, VideoStatus.ai_content_reviewing);
    assert.equal(harness.groups[0].triggerReason, 'formal_manual');
  } finally {
    await harness.cleanup();
  }
});

async function assertRetryBlocked(options: Parameters<typeof createHarness>[0]) {
  const harness = await createHarness({ shadowMode: false, workflowShadowMode: false, ...options });
  try {
    const previous = harness.getWorkflow();
    await assert.rejects(
      harness.service.trigger(ids.video, { id: ids.owner, role: UserRole.director } as any, {}),
      (error: unknown) => error instanceof ConflictException
        && error.message === '当前流程存在其他待处理事项，请先完成后再重新评估。',
    );
    assert.equal(previous.status, 'current');
    assert.equal(harness.workflows.length, 1);
    assert.equal(harness.groups.length, 0);
    assert.equal(harness.runs.length, 0);
    assert.equal(harness.jobs.length, 0);
  } finally {
    await harness.cleanup();
  }
}

test('formal trigger supersedes only a current instability hold workflow and preserves its audit history', async () => {
  const harness = await createHarness({ shadowMode: false, workflowShadowMode: false, evaluationInstabilityHold: true });
  try {
    const previous = harness.getWorkflow();
    const started = await harness.service.trigger(ids.video, { id: ids.owner, role: UserRole.director } as any, {});
    const current = harness.getWorkflow();

    assert.equal(previous.status, 'superseded');
    assert.ok(previous.supersededAt instanceof Date);
    assert.equal(current.revision, 2);
    assert.equal(current.policySnapshot.shadowMode, false);
    assert.equal(current.policySnapshot.retryFromWorkflowRevisionId, previous.id);
    assert.equal(current.policySnapshot.retryReason, 'evaluation_instability');
    assert.equal(harness.holds[0].status, 'active');
    assert.equal(harness.groups.find((group) => group.id === started.groupId)?.workflowRevisionId, current.id);
  } finally {
    await harness.cleanup();
  }
});

test('formal retry rejects evaluation instability combined with incomplete input', async () => {
  await assertRetryBlocked({ holdTypes: ['evaluation_instability', 'input_incomplete'] });
});

test('formal retry rejects evaluation instability combined with a manual hold', async () => {
  await assertRetryBlocked({ holdTypes: ['evaluation_instability', 'manual'] });
});

test('formal retry rejects evaluation instability combined with an appeal hold', async () => {
  await assertRetryBlocked({ holdTypes: ['evaluation_instability', 'appeal'] });
});

test('formal retry rejects evaluation instability when an active appeal record exists', async () => {
  await assertRetryBlocked({ holdTypes: ['evaluation_instability'], activeAppeals: 1 });
});

test('formal retry rejects an incomplete-input hold without instability', async () => {
  await assertRetryBlocked({ holdTypes: ['input_incomplete'] });
});

test('concurrent retries from one instability hold create one current workflow and one active group', async () => {
  const harness = await createHarness({ shadowMode: false, workflowShadowMode: false, evaluationInstabilityHold: true });
  const actor = { id: ids.owner, role: UserRole.director } as any;
  try {
    const results = await Promise.all([
      harness.service.trigger(ids.video, actor, {}),
      harness.service.trigger(ids.video, actor, {}),
    ]);

    assert.equal(harness.workflows.filter((workflow) => workflow.status === 'current').length, 1);
    assert.equal(new Set(results.map((result) => result.groupId)).size, 1);
    assert.equal(harness.groups.filter((group) => ['queued', 'running', 'review_required'].includes(group.status)).length, 1);
  } finally {
    await harness.cleanup();
  }
});

test('formal cutover supersedes the shadow workflow revision before creating the new group', async () => {
  const harness = await createHarness({ shadowMode: false, workflowShadowMode: true });
  try {
    const previousWorkflowId = harness.getWorkflow().id;
    const started = await harness.service.trigger(ids.video, { id: ids.owner, role: UserRole.director } as any, {});
    assert.notEqual(harness.getWorkflow().id, previousWorkflowId);
    assert.equal(harness.getWorkflow().revision, 2);
    assert.equal(harness.getWorkflow().policySnapshot.shadowMode, false);
    assert.equal(harness.groups.find((group) => group.id === started.groupId)?.workflowRevisionId, harness.getWorkflow().id);
  } finally {
    await harness.cleanup();
  }
});

test('formal trigger never reuses a historical shadow or independent pilot group', async () => {
  const harness = await createHarness({ shadowMode: false });
  const admin = { id: ids.admin, role: UserRole.admin } as any;
  try {
    const pilot = await harness.service.triggerPilot(ids.video, { bypassReason: '正式切换前的独立影子验证样本' }, admin, {});
    const formal = await harness.service.trigger(ids.video, admin, {});
    assert.notEqual(formal.groupId, pilot.groupId);
    assert.equal(harness.groups.find((group) => group.id === pilot.groupId)?.shadowMode, true);
    assert.equal(harness.groups.find((group) => group.id === formal.groupId)?.shadowMode, false);
    assert.equal(formal.duplicate, false);
  } finally {
    await harness.cleanup();
  }
});

test('normal V1.1 triggers deduplicate while admin pilot triggers create independent identities with the same fingerprint', async () => {
  const harness = await createHarness({ shadowMode: false });
  const admin = { id: ids.admin, role: UserRole.admin } as any;
  try {
    const normal = [
      await harness.service.trigger(ids.video, admin, {}),
      await harness.service.trigger(ids.video, admin, {}),
      await harness.service.trigger(ids.video, admin, {}),
    ];
    assert.equal(new Set(normal.map((item) => item.groupId)).size, 1);
    assert.deepEqual(normal.map((item) => item.duplicate), [false, true, true]);

    const pilots: Array<Awaited<ReturnType<V11ContentService['triggerPilot']>>> = [];
    for (let index = 1; index <= 3; index += 1) {
      pilots.push(await harness.service.triggerPilot(ids.video, {
        bypassReason: `受控稳定性试点第 ${index} 次独立调用`,
      }, admin, {}));
    }
    assert.equal(new Set(pilots.map((item) => item.groupId)).size, 3);
    assert.equal(new Set(pilots.map((item) => item.runId)).size, 3);
    assert.equal(new Set(pilots.map((item) => item.jobId)).size, 3);
    const pilotGroups = harness.groups.filter((group) => group.pilotRun);
    assert.equal(pilotGroups.length, 3);
    assert.ok(pilotGroups.every((group) => group.independent && group.bypassReason));
    assert.ok(pilotGroups.every((group) => group.shadowMode === true));
    const pilotFingerprints = pilotGroups.map((group) => harness.inputs.find((input) => input.id === group.inputRevisionId).evaluationFingerprint);
    assert.equal(new Set(pilotFingerprints).size, 1);
    assert.equal(harness.jobs.filter((job) => pilots.some((pilot) => pilot.jobId === job.id)).length, 3);
    assert.ok(harness.jobs.filter((job) => pilots.some((pilot) => pilot.jobId === job.id)).every((job) => job.maxAttempts === 1));
  } finally {
    await harness.cleanup();
  }
});

test('ordinary trigger refuses shadow policy so business users cannot create a second scoring channel', async () => {
  const harness = await createHarness({ shadowMode: true });
  try {
    await assert.rejects(
      harness.service.trigger(ids.video, { id: ids.owner, role: UserRole.director } as any, {}),
      /V1.1 formal content evaluation is not enabled/,
    );
    assert.equal(harness.groups.length, 0);
    assert.equal(harness.jobs.length, 0);
  } finally {
    await harness.cleanup();
  }
});

test('trigger contains technical failures, keeps sanitized server diagnostics and preserves HTTP errors', async () => {
  const harness = await createHarness();
  const original = Logger.prototype.error;
  const messages: string[] = [];
  Logger.prototype.error = function (...args: unknown[]) { messages.push(args.map(String).join(' ')); };
  const actor = { id: ids.admin, role: UserRole.admin } as any;
  try {
    harness.db.runtimeSetting.findUnique = async () => { throw new Error('Prisma SQLSTATE 23514 evaluation_jobs_stage_check https://private.test/file?signature=secret'); };
    await assert.rejects(harness.service.trigger(ids.video, actor, {}), (error: unknown) => {
      assert.ok(error instanceof InternalServerErrorException);
      assert.equal(error.message, 'V1.1 评估任务启动失败，请稍后重试或联系管理员。');
      assert.doesNotMatch(JSON.stringify(error.getResponse()), /Prisma|SQLSTATE|constraint|signature/);
      return true;
    });
    assert.match(messages.join(' '), /23514/);
    assert.doesNotMatch(messages.join(' '), /signature=secret/);
    harness.db.runtimeSetting.findUnique = async () => { throw new Error('Video file is unavailable.'); };
    await assert.rejects(harness.service.trigger(ids.video, actor, {}), (error: unknown) =>
      error instanceof ServiceUnavailableException && error.message === '原始视频文件当前不可用，无法发起评估。');
    const denied = new ForbiddenException('denied');
    harness.db.runtimeSetting.findUnique = async () => { throw denied; };
    await assert.rejects(harness.service.trigger(ids.video, actor, {}), (error: unknown) => error === denied);
  } finally {
    Logger.prototype.error = original;
    await harness.cleanup();
  }
});

test('non-administrators cannot use the independent pilot bypass', async () => {
  const harness = await createHarness();
  try {
    await assert.rejects(
      () => harness.service.triggerPilot(ids.video, { bypassReason: '普通用户不得绕过去重执行独立试点' }, { id: ids.owner, role: UserRole.director } as any, {}),
      (error: unknown) => error instanceof ForbiddenException,
    );
    assert.equal(harness.groups.length, 0);
  } finally {
    await harness.cleanup();
  }
});

test('qualified pilot count uses distinct initial videos and excludes appeals, reruns and independent pilot repeats', async () => {
  let query: any;
  const count = await countQualifiedInitialPilotSamples({
    $queryRaw: async (value: any) => { query = value; return [{ count: 50n }]; },
  } as any);
  const sql = query.strings.join('?');
  assert.equal(count, 50);
  assert.match(sql, /COUNT\(DISTINCT g\.video_id\)/);
  assert.match(sql, /g\.parent_group_id IS NULL/);
  assert.match(sql, /g\.independent = false/);
  assert.match(sql, /g\.pilot_run = false/);
  assert.match(sql, /g\.trigger_reason <> 'appeal'/);
  assert.match(sql, /d\.input_complete = true/);
  assert.match(sql, /d\.stable = true/);
});
