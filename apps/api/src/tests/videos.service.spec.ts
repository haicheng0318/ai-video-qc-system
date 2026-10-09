import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { UserRole, Video, VideoStatus, VideoType } from '@prisma/client';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Request, Response } from 'express';
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
const projectRoot = resolve(process.cwd(), '../../');

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

test('video list applies bounded pagination and returns metadata while preserving items', async () => {
  let findArgs: Record<string, unknown> | undefined;
  const prisma = {
    video: {
      findMany: async (args: Record<string, unknown>) => { findArgs = args; return [{ id: 'video-1' }]; },
      count: async () => 41,
    },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  } as unknown as PrismaService;
  const permissions = { buildVideoVisibilityWhere: () => ({ creatorId: testUser.id }) };
  const service = new VideosService(prisma, permissions as never, {} as never);
  (service as unknown as { serializeVideo: (video: unknown) => unknown }).serializeVideo = (video) => video;
  const result = await service.list(testUser, { page: 3, pageSize: 20, search: 'summer' });
  assert.equal(findArgs?.skip, 40);
  assert.equal(findArgs?.take, 20);
  const include = findArgs?.include as Record<string, any>;
  assert.deepEqual(include.v11DataDecisions.where, { workflowRevision: { status: 'current' } });
  assert.deepEqual(include.v11ComprehensiveDecisions.where, { workflowRevision: { status: 'current' } });
  assert.equal(include.v11DataDecisions.take, 1);
  assert.equal(include.v11ComprehensiveDecisions.take, 1);
  assert.deepEqual(result, { items: [{ id: 'video-1' }], total: 41, page: 3, pageSize: 20 });
});

test('video list search preserves supervisor team visibility scope', async () => {
  let findArgs: Record<string, any> | undefined;
  const prisma = {
    video: {
      findMany: async (args: Record<string, any>) => { findArgs = args; return []; },
      count: async () => 0,
    },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  } as unknown as PrismaService;
  const supervisor = { ...testUser, id: 'supervisor-id', role: UserRole.supervisor };
  const visibility = {
    OR: [
      { creatorId: supervisor.id },
      { creator: { managerId: supervisor.id } },
    ],
  };
  const permissions = { buildVideoVisibilityWhere: () => visibility };
  const service = new VideosService(prisma, permissions as never, {} as never);
  await service.list(supervisor, { page: 1, pageSize: 20, search: 'summer' });

  assert.deepEqual(findArgs?.where, {
    AND: [
      visibility,
      {
        OR: [
          { title: { contains: 'summer', mode: 'insensitive' } },
          { brand: { contains: 'summer', mode: 'insensitive' } },
          { product: { contains: 'summer', mode: 'insensitive' } },
          { platform: { contains: 'summer', mode: 'insensitive' } },
        ],
      },
    ],
  });
});

function videoFile(filePath: string, size: number): Video {
  return {
    isTrial: false,
    id: '00000000-0000-4000-8000-000000000099',
    title: 'Stream fixture',
    originalFileName: 'fixture.mp4',
    filePath,
    fileUrl: null,
    coverUrl: null,
    mimeType: 'video/mp4',
    fileSizeBytes: BigInt(size),
    duration: null,
    brand: null,
    product: null,
    platform: null,
    videoType: VideoType.product_card,
    scriptDescription: null,
    isForAds: false,
    isEventVideo: false,
    eventName: null,
    relatedRequirement: null,
    creatorId: testUser.id,
    status: VideoStatus.submitted,
    parentVideoId: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function streamResult(service: VideosService, video: Video, range?: string) {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  let status = 0;
  let headers: Record<string, string | number> = {};
  output.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  Object.assign(output, {
    writeHead: (nextStatus: number, nextHeaders: Record<string, string | number>) => {
      status = nextStatus;
      headers = nextHeaders;
      return output;
    },
  });
  service.streamVideoFile(
    video,
    { headers: range === undefined ? {} : { range } } as Request,
    output as unknown as Response,
  );
  await once(output, 'finish');
  return { status, headers, body: Buffer.concat(chunks) };
}

const parentVideoId = '00000000-0000-4000-8000-000000000030';

function createRevisionHarness(options: {
  status?: VideoStatus;
  creatorId?: string;
  deny?: boolean;
  hasReview?: boolean;
  activeRevisionStatus?: VideoStatus;
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
    parentVideoId: null as string | null,
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
      findFirst: async ({ where }: {
        where: { status: { in: VideoStatus[] } };
      }) => options.activeRevisionStatus && where.status.in.includes(options.activeRevisionStatus)
        ? { id: 'active-revision' }
        : null,
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
  const harness = createRevisionHarness({ activeRevisionStatus: VideoStatus.submitted });
  try {
    await assert.rejects(
      harness.service.createRevision(parentVideoId, {}, uploadFile(fixture.filePath), testUser, {}),
      ConflictException,
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('revision-required direct child blocks a sibling revision from V1', async () => {
  const fixture = await createFixtureFile();
  const harness = createRevisionHarness({
    activeRevisionStatus: VideoStatus.revision_required,
  });
  try {
    await assert.rejects(
      harness.service.createRevision(parentVideoId, {}, uploadFile(fixture.filePath), testUser, {}),
      ConflictException,
    );
    assert.equal(harness.createdVideos.length, 0);
    assert.equal(harness.parent.status, VideoStatus.revision_required);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('V2 requiring revision can create V3 as its direct submitted child', async () => {
  const fixture = await createFixtureFile();
  const harness = createRevisionHarness();
  harness.parent.id = '00000000-0000-4000-8000-000000000031';
  harness.parent.parentVideoId = parentVideoId;
  harness.parent.version = 2;
  try {
    const result = await harness.service.createRevision(
      harness.parent.id,
      { title: 'V3' },
      uploadFile(fixture.filePath),
      testUser,
      {},
    );
    assert.equal(result.parentVideoId, harness.parent.id);
    assert.equal(result.creatorId, testUser.id);
    assert.equal(result.status, VideoStatus.submitted);
    assert.equal(result.version, 3);
    assert.equal(harness.parent.parentVideoId, parentVideoId);
    assert.equal(harness.parent.status, VideoStatus.revision_required);
    assert.equal(harness.createdVideos.length, 1);
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

test('video response removes AI audit payloads and local file paths recursively', () => {
  const response = (createService({} as PrismaService) as any).serializeVideo({
    id: 'video', filePath: 'storage/videos/private.mp4',
    finalVideoEvaluations: [{ id: 'evaluation', rawResponse: { secret: true }, successKey: 'internal' }],
  });
  assert.equal('filePath' in response, false);
  assert.equal('rawResponse' in response.finalVideoEvaluations[0], false);
  assert.equal('successKey' in response.finalVideoEvaluations[0], false);
});

test('video detail response normalizes null supervisor revision requirements', () => {
  const response = (createService({} as PrismaService) as any).serializeVideo({
    id: 'video',
    supervisorReview: {
      id: 'review',
      decision: VideoStatus.approved_for_publish,
      revisionRequirements: null,
    },
  });

  assert.deepEqual(response.supervisorReview.revisionRequirements, []);
});

test('video stream serves the complete file without a Range header', async () => {
  const storageRoot = await mkdtemp(join(projectRoot, 'storage/videos/stream-'));
  const filePath = join(storageRoot, 'complete.mp4');
  const content = Buffer.from(Array.from({ length: 1000 }, (_, index) => index % 256));
  await writeFile(filePath, content);
  try {
    const result = await streamResult(
      createService({} as PrismaService),
      videoFile(relative(projectRoot, filePath), content.length),
    );
    assert.equal(result.status, 200);
    assert.equal(result.headers['Content-Length'], content.length);
    assert.deepEqual(result.body, content);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

for (const scenario of [
  { range: 'bytes=0-99', start: 0, end: 99 },
  { range: 'bytes=100-', start: 100, end: 999 },
  { range: 'bytes=-500', start: 500, end: 999 },
  { range: 'bytes=-5000', start: 0, end: 999 },
  { range: 'bytes=900-5000', start: 900, end: 999 },
]) {
  test(`${scenario.range} serves a valid single byte range`, async () => {
    const storageRoot = await mkdtemp(join(projectRoot, 'storage/videos/stream-'));
    const filePath = join(storageRoot, 'range.mp4');
    const content = Buffer.from(Array.from({ length: 1000 }, (_, index) => index % 256));
    await writeFile(filePath, content);
    try {
      const result = await streamResult(
        createService({} as PrismaService),
        videoFile(relative(projectRoot, filePath), content.length),
        scenario.range,
      );
      assert.equal(result.status, 206);
      assert.equal(result.headers['Content-Length'], scenario.end - scenario.start + 1);
      assert.equal(result.headers['Content-Range'], `bytes ${scenario.start}-${scenario.end}/${content.length}`);
      assert.deepEqual(result.body, content.subarray(scenario.start, scenario.end + 1));
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });
}

for (const range of [
  'bytes=abc-',
  'items=0-10',
  'bytes=100-50',
  'bytes=1000-',
  'bytes=99999999999-',
  'bytes=0-10,20-30',
  'bytes=-0',
  'bytes=-',
  '',
]) {
  test(`${range || 'empty Range'} returns 416 without a stream error`, async () => {
    const storageRoot = await mkdtemp(join(projectRoot, 'storage/videos/stream-'));
    const filePath = join(storageRoot, 'invalid-range.mp4');
    const content = Buffer.alloc(1000, 7);
    await writeFile(filePath, content);
    try {
      const result = await streamResult(
        createService({} as PrismaService),
        videoFile(relative(projectRoot, filePath), content.length),
        range,
      );
      assert.equal(result.status, 416);
      assert.equal(result.headers['Content-Range'], `bytes */${content.length}`);
      assert.equal(result.headers['Content-Length'], 0);
      assert.equal(result.body.length, 0);
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });
}

test('video stream allows a file inside the configured storage root', async () => {
  const storageRoot = await mkdtemp(join(projectRoot, 'storage/videos/path-'));
  const filePath = join(storageRoot, 'inside.mp4');
  await writeFile(filePath, 'inside');
  try {
    const result = await streamResult(
      createService({} as PrismaService),
      videoFile(relative(projectRoot, filePath), 6),
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.toString(), 'inside');
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test('video stream rejects a sibling directory with the storage prefix', () => {
  const siblingPath = join(projectRoot, 'storage/videos_evil/escape.mp4');
  assert.throws(
    () => createService({} as PrismaService).streamVideoFile(
      videoFile(relative(projectRoot, siblingPath), 1),
      { headers: {} } as Request,
      new PassThrough() as unknown as Response,
    ),
    NotFoundException,
  );
});

test('video stream rejects a parent traversal outside the storage root', () => {
  assert.throws(
    () => createService({} as PrismaService).streamVideoFile(
      videoFile('storage/videos/../../outside.mp4', 1),
      { headers: {} } as Request,
      new PassThrough() as unknown as Response,
    ),
    NotFoundException,
  );
});
