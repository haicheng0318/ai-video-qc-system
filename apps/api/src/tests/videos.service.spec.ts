import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { UserRole, VideoStatus, VideoType } from '@prisma/client';
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
