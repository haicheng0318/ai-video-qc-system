import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { PrismaClient, UserRole, VideoStatus, VideoType } from '@prisma/client';
import { V11ContentService } from '../modules/v11/v11-content.service';

const databaseUrl = process.env.OPS_TEST_DATABASE_URL;
const client = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null;
const createdUserIds: string[] = [];
const createdVideoIds: string[] = [];

after(async () => {
  if (!client) return;
  if (createdVideoIds.length) {
    await client.v11EvaluationDecision.deleteMany({ where: { group: { videoId: { in: createdVideoIds } } } });
    await client.v11WorkflowHold.deleteMany({ where: { videoId: { in: createdVideoIds } } });
    await client.v11EvaluationRun.deleteMany({ where: { group: { videoId: { in: createdVideoIds } } } });
    await client.v11EvaluationGroup.deleteMany({ where: { videoId: { in: createdVideoIds } } });
    await client.v11EvaluationInputRevision.deleteMany({ where: { videoId: { in: createdVideoIds } } });
    await client.v11WorkflowRevision.deleteMany({ where: { videoId: { in: createdVideoIds } } });
    await client.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  }
  if (createdUserIds.length) await client.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await client.$disconnect();
});

test('isolated database serializes concurrent retries and preserves the superseded instability hold', { skip: !client }, async () => {
  const userId = randomUUID();
  const videoId = randomUUID();
  const workflowId = randomUUID();
  const directory = await mkdtemp(join(tmpdir(), 'v11-hold-retry-'));
  const mediaPath = join(directory, 'fixture.mp4');
  await writeFile(mediaPath, 'isolated hold retry fixture');
  createdUserIds.push(userId);
  createdVideoIds.push(videoId);
  try {
    await client!.$transaction(async (tx) => {
      await tx.user.create({ data: {
        id: userId,
        account: `retry-${userId}`,
        passwordHash: 'not-a-login-secret',
        name: 'Retry integration fixture',
        role: UserRole.admin,
      } });
      await tx.video.create({ data: {
        id: videoId,
        title: 'Retry integration fixture',
        originalFileName: 'fixture.mp4',
        filePath: mediaPath,
        mimeType: 'video/mp4',
        fileSizeBytes: 27,
        videoType: VideoType.organic,
        creatorId: userId,
        status: VideoStatus.ai_content_failed,
      } });
      await tx.v11WorkflowRevision.create({ data: {
        id: workflowId,
        videoId,
        ownerId: userId,
        revision: 2,
        policySnapshot: { shadowMode: false },
      } });
      await tx.v11WorkflowHold.create({ data: {
        videoId,
        workflowRevisionId: workflowId,
        holdType: 'evaluation_instability',
        reason: '评估结果存在严重分歧：major_fact_conflict',
      } });
    });

    const service = new V11ContentService(
      client as any,
      { assertCanTriggerContentReview: async () => undefined } as any,
      { create: async () => ({ id: randomUUID() }) } as any,
      { materialize: async () => ({ path: mediaPath, cleanup: async () => undefined }) } as any,
      { enqueue: async () => ({ id: randomUUID() }) } as any,
      { analyzeVideo: async () => { throw new Error('model must not be called by trigger integration'); } } as any,
    );
    const actor = { id: userId, role: UserRole.admin } as any;
    const results = await Promise.all([
      service.trigger(videoId, actor, {}),
      service.trigger(videoId, actor, {}),
    ]);

    const workflows = await client!.v11WorkflowRevision.findMany({ where: { videoId }, orderBy: { revision: 'asc' } });
    const oldHold = await client!.v11WorkflowHold.findFirstOrThrow({ where: { workflowRevisionId: workflowId } });
    const currentGroups = await client!.v11EvaluationGroup.findMany({ where: { videoId, workflowRevision: { status: 'current' } } });
    assert.deepEqual(workflows.map((workflow) => [workflow.revision, workflow.status]), [[2, 'superseded'], [3, 'current']]);
    assert.equal(oldHold.status, 'active');
    assert.equal(currentGroups.length, 1);
    assert.equal(new Set(results.map((result) => result.groupId)).size, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('one workflow revision stores appeal, instability and incomplete-input holds simultaneously', { skip: !client }, async () => {
  const userId = randomUUID();
  const videoId = randomUUID();
  const workflowId = randomUUID();
  createdUserIds.push(userId);
  createdVideoIds.push(videoId);
  await client!.$transaction(async (tx) => {
    await tx.user.create({ data: {
      id: userId,
      account: `hold-${userId}`,
      passwordHash: 'not-a-login-secret',
      name: 'Hold integration fixture',
      role: UserRole.admin,
    } });
    await tx.video.create({ data: {
      id: videoId,
      title: 'Hold integration fixture',
      originalFileName: 'fixture.mp4',
      filePath: `fixture/${videoId}.mp4`,
      mimeType: 'video/mp4',
      fileSizeBytes: 1,
      videoType: VideoType.organic,
      creatorId: userId,
      status: VideoStatus.submitted,
    } });
    await tx.v11WorkflowRevision.create({ data: {
      id: workflowId,
      videoId,
      ownerId: userId,
      revision: 1,
      policySnapshot: {},
    } });
    await tx.v11WorkflowHold.createMany({ data: [
      { videoId, workflowRevisionId: workflowId, holdType: 'appeal', reason: 'Appeal hold' },
      { videoId, workflowRevisionId: workflowId, holdType: 'evaluation_instability', reason: 'Instability hold' },
      { videoId, workflowRevisionId: workflowId, holdType: 'input_incomplete', reason: 'Input hold' },
    ] });
  });
  const holds = await client!.v11WorkflowHold.findMany({
    where: { workflowRevisionId: workflowId, status: 'active' },
    orderBy: { holdType: 'asc' },
  });
  assert.deepEqual(holds.map((hold) => hold.holdType), ['appeal', 'evaluation_instability', 'input_incomplete']);
});
