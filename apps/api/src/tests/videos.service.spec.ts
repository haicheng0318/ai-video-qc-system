import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { UserRole, VideoStatus, VideoType } from '@prisma/client';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { OperationLogsService } from '../modules/operation-logs/operation-logs.service';
import { VideosService } from '../modules/videos/videos.service';
import { PrismaService } from '../modules/prisma/prisma.service';

const testUser = {
  id: 'director-id',
  account: 'director',
  name: 'Director',
  role: UserRole.director,
  managerId: null,
};

async function createFixtureFile() {
  const directory = await mkdtemp(join(tmpdir(), 'ai-video-qc-upload-'));
  const filePath = join(directory, 'upload.mp4');
  await writeFile(filePath, 'test-video');
  return { directory, filePath };
}

function uploadFile(filePath: string) {
  return {
    path: filePath,
    originalname: 'upload.mp4',
    mimetype: 'video/mp4',
    size: 10,
  } as Express.Multer.File;
}

function createService(prisma: PrismaService, operationLogs = new OperationLogsService({} as PrismaService)) {
  return new VideosService(prisma, {} as import('../modules/permissions/permissions.service').PermissionsService, operationLogs);
}

const parentVideoId = '00000000-0000-4000-8000-000000000030';

function createRevisionHarness(options: {
  status?: VideoStatus;
  creatorId?: string;
  deny?: boolean;
  hasReview?: boolean;
  activeRevision?: boolean;
  failCreate?: boolean;
} = {}) {
  const parent = {
    id: parentVideoId,
    title: 'Parent video',
    originalFileName: 'parent.mp4',
    filePath: 'storage/videos/parent.mp4',
    fileUrl: null,
    coverUrl: null,
    mimeType: 'video/mp4',
    fileSizeBytes: BigInt(100),
    duration: null,
    brand: 'Brand',
    product: 'Product',
    platform: '抖音',
    videoType: VideoType.product_card,
    scriptDescription: 'Original script',
    isForAds: false,
    isEventVideo: false,
    eventName: null,
    relatedRequirement: null,
    creatorId: options.creatorId || testUser.id,
    status: options.status || VideoStatus.revision_required,
    parentVideoId: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const logs: Array<Record<string, unknown>> = [];
  const createdVideos: Array<Record<string, any>> = [];
  const transaction = {
    $queryRaw: async () => [],
    video: {
      findUnique: async () => parent,
      findFirst: async () => options.activeRevision ? { id: 'active-revision' } : null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (options.failCreate) throw new Error('revision database create failed');
        const created = {
          id: 'revision-video-id',
          ...data,
          creator: { id: parent.creatorId, name: 'Director', account: 'director', role: UserRole.director },
        };
        createdVideos.push(created);
        return created;
      },
    },
    supervisorReview: {
      findUnique: async () => options.hasReview === false ? null : {
        id: 'supervisor-review',
        decision: VideoStatus.revision_required,
      },
    },
  };
  const prisma = {
    video: { findUnique: async () => parent },
    $transaction: async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
  } as unknown as PrismaService;
  const permissions = {
    assertCanUploadRevision: async () => {
      if (options.deny) throw new ForbiddenException();
    },
  };
  const operationLogs = { create: async (input: Record<string, unknown>) => logs.push(input) };
  const service = new VideosService(prisma, permissions as never, operationLogs as never);
  return { service, parent, logs, createdVideos };
}

test('database create failure removes the Multer file', async () => {
  const fixture = await createFixtureFile();
  const prisma = {
    $transaction: async (callback: (transaction: unknown) => Promise<unknown>) =>
      callback({
        video: {
          create: async () => {
            throw new Error('video create failed');
          },
        },
      }),
  } as unknown as PrismaService;

  try {
    await assert.rejects(
      createService(prisma).create(
        { title: 'Upload', videoType: VideoType.product_card },
        uploadFile(fixture.filePath),
        testUser,
        {},
      ),
      /video create failed/,
    );
    assert.equal(existsSync(fixture.filePath), false);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('operation log failure rolls back the video transaction and removes the file', async () => {
  const fixture = await createFixtureFile();
  let committed = false;
  const prisma = {
    $transaction: async (callback: (transaction: unknown) => Promise<unknown>) => {
      const result = await callback({
        video: {
          create: async () => ({
            id: 'video-id',
            title: 'Upload',
            videoType: VideoType.product_card,
            status: VideoStatus.submitted,
            originalFileName: 'upload.mp4',
          }),
        },
        operationLog: {
          create: async () => {
            throw new Error('operation log create failed');
          },
        },
      });
      committed = true;
      return result;
    },
  } as unknown as PrismaService;

  try {
    await assert.rejects(
      createService(prisma).create(
        { title: 'Upload', videoType: VideoType.product_card },
        uploadFile(fixture.filePath),
        testUser,
        {},
      ),
      /operation log create failed/,
    );
    assert.equal(committed, false);
    assert.equal(existsSync(fixture.filePath), false);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('transaction failure keeps the original database error when cleanup also fails', async () => {
  const fixture = await createFixtureFile();
  const prisma = {
    $transaction: async (callback: (transaction: unknown) => Promise<unknown>) =>
      callback({
        video: {
          create: async () => {
            throw new Error('original database failure');
          },
        },
      }),
  } as unknown as PrismaService;

  await rm(fixture.filePath);
  try {
    await assert.rejects(
      createService(prisma).create(
        { title: 'Upload', videoType: VideoType.product_card },
        uploadFile(fixture.filePath),
        testUser,
        {},
      ),
      /original database failure/,
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('original creator uploads a revision with direct parent, preserved creator and submitted status', async () => {
  const fixture = await createFixtureFile();
  const harness = createRevisionHarness();
  try {
    const result = await harness.service.createRevision(
      parentVideoId,
      { title: 'V2', scriptDescription: 'Revised script' },
      uploadFile(fixture.filePath),
      testUser,
      {},
    );
    assert.equal(result.parentVideoId, parentVideoId);
    assert.equal(result.creatorId, testUser.id);
    assert.equal(result.status, VideoStatus.submitted);
    assert.equal(result.version, 2);
    assert.equal(result.scriptDescription, 'Revised script');
    assert.equal(harness.parent.status, VideoStatus.revision_required);
    assert.equal(harness.logs[0].actionType, 'video_revision_uploaded');
    assert.equal((harness.logs[0].afterValue as Record<string, unknown>).parentVideoId, parentVideoId);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('admin proxy upload keeps original video creator ownership', async () => {
  const fixture = await createFixtureFile();
  const harness = createRevisionHarness({ creatorId: 'original-director' });
  const admin = { ...testUser, id: 'admin-id', role: UserRole.admin };
  try {
    const result = await harness.service.createRevision(parentVideoId, {}, uploadFile(fixture.filePath), admin, {});
    assert.equal(result.creatorId, 'original-director');
    assert.equal((harness.logs[0].afterValue as Record<string, unknown>).uploadedBy, 'admin-id');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('non-creator cannot upload a revision and uploaded file is removed', async () => {
  const fixture = await createFixtureFile();
  const harness = createRevisionHarness({ deny: true });
  try {
    await assert.rejects(
      harness.service.createRevision(parentVideoId, {}, uploadFile(fixture.filePath), testUser, {}),
      ForbiddenException,
    );
    assert.equal(existsSync(fixture.filePath), false);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('non-revision-required parent cannot accept revision', async () => {
  const fixture = await createFixtureFile();
  const harness = createRevisionHarness({ status: VideoStatus.approved_for_publish });
  try {
    await assert.rejects(
      harness.service.createRevision(parentVideoId, {}, uploadFile(fixture.filePath), testUser, {}),
      ConflictException,
    );
    assert.equal(existsSync(fixture.filePath), false);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('revision upload requires a matching supervisor review', async () => {
  const fixture = await createFixtureFile();
  const harness = createRevisionHarness({ hasReview: false });
  try {
    await assert.rejects(
      harness.service.createRevision(parentVideoId, {}, uploadFile(fixture.filePath), testUser, {}),
      ConflictException,
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('parallel active direct revision is rejected', async () => {
  const fixture = await createFixtureFile();
  const harness = createRevisionHarness({ activeRevision: true });
  try {
    await assert.rejects(
      harness.service.createRevision(parentVideoId, {}, uploadFile(fixture.filePath), testUser, {}),
      ConflictException,
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('revision database failure removes orphan file and keeps original error', async () => {
  const fixture = await createFixtureFile();
  const harness = createRevisionHarness({ failCreate: true });
  try {
    await assert.rejects(
      harness.service.createRevision(parentVideoId, {}, uploadFile(fixture.filePath), testUser, {}),
      /revision database create failed/,
    );
    assert.equal(existsSync(fixture.filePath), false);
    assert.equal(harness.createdVideos.length, 0);
    assert.equal(harness.parent.status, VideoStatus.revision_required);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
