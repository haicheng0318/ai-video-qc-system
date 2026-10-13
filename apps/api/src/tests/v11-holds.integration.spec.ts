import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { PrismaClient, UserRole, VideoStatus, VideoType } from '@prisma/client';

const databaseUrl = process.env.OPS_TEST_DATABASE_URL;
const client = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null;
const createdUserIds: string[] = [];
const createdVideoIds: string[] = [];

after(async () => {
  if (!client) return;
  if (createdVideoIds.length) {
    await client.v11WorkflowHold.deleteMany({ where: { videoId: { in: createdVideoIds } } });
    await client.v11WorkflowRevision.deleteMany({ where: { videoId: { in: createdVideoIds } } });
    await client.video.deleteMany({ where: { id: { in: createdVideoIds } } });
  }
  if (createdUserIds.length) await client.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await client.$disconnect();
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
