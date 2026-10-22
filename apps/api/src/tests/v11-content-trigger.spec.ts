import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ForbiddenException, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { UserRole, VideoStatus, VideoType } from '@prisma/client';
import { countQualifiedInitialPilotSamples, V11ContentService } from '../modules/v11/v11-content.service';

const ids = {
  video: '20000000-0000-4000-8000-000000000001',
  owner: '20000000-0000-4000-8000-000000000002',
  admin: '20000000-0000-4000-8000-000000000003',
  workflow: '20000000-0000-4000-8000-000000000004',
};

async function createHarness() {
  const directory = await mkdtemp(join(tmpdir(), 'v11-pilot-trigger-'));
  const path = join(directory, 'fixture.mp4');
  await writeFile(path, 'same frozen media bytes');
  const groups: any[] = [];
  const inputs: any[] = [];
  const runs: any[] = [];
  const jobs: any[] = [];
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
  const workflow = { id: ids.workflow, videoId: ids.video, ownerId: ids.owner, revision: 1, status: 'current' };
  const tx: any = {
    $queryRaw: async () => [],
    v11EvaluationGroup: {
      findFirst: async ({ where }: any) => {
        const group = groups.slice().reverse().find((candidate) => candidate.ownerId === where.ownerId
          && ['queued', 'running', 'review_required', 'adopted'].includes(candidate.status)
          && inputs.find((input) => input.id === candidate.inputRevisionId)?.evaluationFingerprint === where.inputRevision.evaluationFingerprint);
        return group ? { ...group, runs: runs.filter((run) => run.groupId === group.id) } : null;
      },
      create: async ({ data }: any) => {
        const group = { id: id(), status: 'queued', ...data };
        groups.push(group);
        return group;
      },
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
      findFirst: async () => workflow,
      create: async () => workflow,
    },
    v11EvaluationRun: {
      create: async ({ data }: any) => {
        const run = { id: id(), ...data };
        runs.push(run);
        return run;
      },
    },
  };
  const db: any = {
    runtimeSetting: { findUnique: async () => ({ value: { enabled: true, shadowMode: true } }) },
    video: { findUnique: async () => video },
    aiModelConfig: { findFirst: async () => null },
    $transaction: async (callback: (client: any) => unknown) => callback(tx),
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
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test('normal V1.1 triggers deduplicate while admin pilot triggers create independent identities with the same fingerprint', async () => {
  const harness = await createHarness();
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
    const pilotFingerprints = pilotGroups.map((group) => harness.inputs.find((input) => input.id === group.inputRevisionId).evaluationFingerprint);
    assert.equal(new Set(pilotFingerprints).size, 1);
    assert.equal(harness.jobs.filter((job) => pilots.some((pilot) => pilot.jobId === job.id)).length, 3);
    assert.ok(harness.jobs.filter((job) => pilots.some((pilot) => pilot.jobId === job.id)).every((job) => job.maxAttempts === 1));
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
