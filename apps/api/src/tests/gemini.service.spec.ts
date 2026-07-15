import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { UserRole, VideoStatus } from '@prisma/client';
import { GeminiService } from '../modules/ai/gemini/gemini.service';
import { GeminiConfigurationError } from '../modules/ai/gemini/gemini.errors';
import { OperationLogsService } from '../modules/operation-logs/operation-logs.service';
import { PermissionsService } from '../modules/permissions/permissions.service';
import { PrismaService } from '../modules/prisma/prisma.service';

const user = {
  id: 'director-id',
  account: 'director',
  name: 'Director',
  role: UserRole.director,
  managerId: null,
};

const video = {
  id: '00000000-0000-4000-8000-000000000001',
  creatorId: user.id,
  filePath: 'storage/videos/gemini-service-test.mp4',
  mimeType: 'video/mp4',
  platform: '抖音',
  videoType: 'product_card',
  brand: 'Brand',
  product: 'Product',
  isForAds: true,
  isEventVideo: false,
  eventName: null,
  scriptDescription: 'Script',
  relatedRequirement: null,
  status: VideoStatus.submitted,
};

const successfulRawResponse = JSON.stringify({
  contentSummary: '内容清晰',
  totalScore: 90,
  contentGrade: 'S',
  isPublishableRecommendation: true,
  mainProblems: [],
  revisionSuggestions: [],
  complianceRisks: [],
  usableScenarios: ['投放'],
  scores: [{ dimension: '信息表达', score: 10, maxScore: 10, comment: '清晰' }],
});

async function withVideoFile(run: () => Promise<void>) {
  const filePath = resolve(process.cwd(), '../../storage/videos/gemini-service-test.mp4');
  await mkdir(resolve(process.cwd(), '../../storage/videos'), { recursive: true });
  await writeFile(filePath, 'test video');
  try {
    await run();
  } finally {
    await rm(filePath, { force: true });
  }
}

function createHarness(options: {
  status?: VideoStatus;
  running?: boolean;
  analyze?: () => Promise<{ rawResponse: string }>;
} = {}) {
  const logs: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const currentVideo = { ...video, status: options.status || VideoStatus.submitted };
  const tx = {
    $queryRaw: async () => [],
    video: {
      findUnique: async () => currentVideo,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push({ entity: 'video', ...data });
        return currentVideo;
      },
    },
    aiContentReview: {
      findFirst: async () => options.running ? { id: 'running-review' } : null,
      create: async () => ({ id: 'new-review' }),
      update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        updates.push({ entity: 'review', ...where, ...data });
        return { id: 'new-review' };
      },
    },
    aiModelConfig: {
      findFirst: async () => null,
    },
    contentReviewScore: {
      createMany: async ({ data }: { data: unknown[] }) => {
        updates.push({ entity: 'scores', data });
        return { count: data.length };
      },
    },
  };
  const prisma = {
    video: { findUnique: async () => currentVideo },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
  } as unknown as PrismaService;
  const permissions = {
    assertCanTriggerContentReview: async () => undefined,
    assertCanAccessVideo: async () => undefined,
  } as unknown as PermissionsService;
  const operationLogs = {
    create: async (input: Record<string, unknown>) => {
      logs.push(input);
    },
  } as unknown as OperationLogsService;
  const client = {
    analyzeVideo: options.analyze || (async () => ({ rawResponse: successfulRawResponse })),
  };
  return {
    service: new GeminiService(prisma, permissions, operationLogs, client as never),
    logs,
    updates,
  };
}

test('content review rejects missing video with 404', async () => {
  const harness = createHarness();
  (harness.service as unknown as { prisma: { video: { findUnique: (_args?: unknown) => Promise<null> } } }).prisma.video.findUnique = async () => null;
  await assert.rejects(harness.service.reviewVideo('missing', user, {}), NotFoundException);
});

test('content review rejects unauthorized trigger with 403', async () => {
  const permissions = {
    assertCanTriggerContentReview: async () => { throw new ForbiddenException(); },
  } as unknown as PermissionsService;
  const service = new GeminiService(
    { video: { findUnique: async () => video } } as unknown as PrismaService,
    permissions,
    {} as OperationLogsService,
    {} as never,
  );
  await assert.rejects(service.reviewVideo(video.id, user, {}), ForbiddenException);
});

test('content review rejects invalid video state and duplicate running work with 409', async () => {
  const invalidState = createHarness({ status: VideoStatus.pending_supervisor_review });
  await assert.rejects(invalidState.service.reviewVideo(video.id, user, {}), ConflictException);

  const duplicate = createHarness({ running: true });
  await assert.rejects(duplicate.service.reviewVideo(video.id, user, {}), ConflictException);
});

test('successful content review updates scores, status, and operation logs', async () => {
  await withVideoFile(async () => {
    const harness = createHarness();
    const result = await harness.service.reviewVideo(video.id, user, {});
    assert.equal(result.videoStatus, VideoStatus.pending_supervisor_review);
    assert.ok(harness.updates.some((item) => item.entity === 'scores'));
    assert.ok(harness.updates.some((item) => item.entity === 'video' && item.status === VideoStatus.pending_supervisor_review));
    assert.ok(harness.logs.some((log) => log.actionType === 'ai_content_review_started'));
    assert.ok(harness.logs.some((log) => log.actionType === 'ai_content_review_completed' && log.result === 'success'));
  });
});

test('configuration failure marks the new review failed without overwriting history', async () => {
  await withVideoFile(async () => {
    const harness = createHarness({ analyze: async () => { throw new GeminiConfigurationError('not configured'); } });
    await assert.rejects(harness.service.reviewVideo(video.id, user, {}), ServiceUnavailableException);
    assert.ok(harness.updates.some((item) => item.entity === 'review' && item.status === 'failed' && item.id === 'new-review'));
    assert.ok(harness.updates.some((item) => item.entity === 'video' && item.status === VideoStatus.ai_content_failed));
    assert.ok(harness.logs.some((log) => log.actionType === 'ai_content_review_failed' && log.result === 'failure'));
  });
});
