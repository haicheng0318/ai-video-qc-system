import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AiReviewStatus, UserRole, VideoStatus } from '@prisma/client';
import {
  ContentReviewBackgroundTask,
  ContentReviewService,
  sanitizeContentReviewText,
} from '../modules/ai/gemini/gemini.service';
import { ContentReviewConfigurationError } from '../modules/ai/gemini/gemini.errors';
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

const baseVideo = {
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

const successfulOutput = {
  contentSummary: '内容清晰',
  totalScore: 90,
  contentGrade: 'S',
  isPublishableRecommendation: true,
  mainProblems: [],
  revisionSuggestions: [],
  complianceRisks: [],
  usableScenarios: ['投放'],
  scores: [{ dimension: '信息表达', score: 10, maxScore: 10, comment: '清晰' }],
};
const successfulRawResponse = JSON.stringify(successfulOutput);

type ReviewRecord = {
  id: string;
  videoId: string;
  modelProvider: string;
  modelName: string;
  status: AiReviewStatus;
  createdAt: Date;
  errorMessage: string | null;
  rawResponse?: unknown;
  scores?: unknown[];
  [key: string]: unknown;
};

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
  runningCreatedAt?: Date;
  analyze?: () => Promise<{ rawResponse: string }>;
  missingVideo?: boolean;
  denyTrigger?: boolean;
  denyAccess?: boolean;
  failFailurePersistence?: boolean;
  useDefaultScheduler?: boolean;
} = {}) {
  const logs: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const tasks: ContentReviewBackgroundTask[] = [];
  const video = { ...baseVideo, status: options.status || VideoStatus.submitted };
  const reviews: ReviewRecord[] = [];
  if (options.runningCreatedAt) {
    reviews.push({
      id: 'stale-or-fresh-review',
      videoId: video.id,
      modelProvider: 'aliyun_bailian',
      modelName: 'qwen3.5-omni-plus',
      status: AiReviewStatus.running,
      createdAt: options.runningCreatedAt,
      errorMessage: null,
    });
  }

  const aiContentReview = {
    findMany: async () => reviews.filter((review) => review.status === AiReviewStatus.running),
    findUnique: async ({ where }: { where: { id: string } }) =>
      reviews.find((review) => review.id === where.id) || null,
    findFirst: async ({ where }: { where: { videoId: string; id?: string } }) =>
      reviews.filter((review) => review.videoId === where.videoId && (!where.id || review.id === where.id)).at(-1) || null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const review: ReviewRecord = {
        id: `review-${reviews.length + 1}`,
        videoId: String(data.videoId),
        modelProvider: String(data.modelProvider),
        modelName: String(data.modelName),
        status: data.status as AiReviewStatus,
        createdAt: new Date(),
        errorMessage: null,
        scores: [],
      };
      reviews.push(review);
      updates.push({ entity: 'review-created', id: review.id, ...data });
      return review;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      if (options.failFailurePersistence && data.status === AiReviewStatus.failed) {
        throw new Error('database unavailable at /Users/private/path');
      }
      const review = reviews.find((item) => item.id === where.id);
      if (!review) throw new Error('review missing');
      Object.assign(review, data);
      updates.push({ entity: 'review', id: where.id, ...data });
      return review;
    },
  };

  const transaction = {
    $queryRaw: async () => [],
    video: {
      findUnique: async () => options.missingVideo ? null : video,
      update: async ({ data }: { data: { status?: VideoStatus } }) => {
        if (data.status) video.status = data.status;
        updates.push({ entity: 'video', ...data });
        return video;
      },
    },
    aiContentReview,
    aiModelConfig: { findFirst: async () => null },
    contentReviewScore: {
      createMany: async ({ data }: { data: unknown[] }) => {
        const current = reviews.at(-1);
        if (current) current.scores = data;
        updates.push({ entity: 'scores', data });
        return { count: data.length };
      },
    },
  };
  const prisma = {
    video: { findUnique: async () => options.missingVideo ? null : video },
    aiContentReview,
    $transaction: async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
  } as unknown as PrismaService;
  const permissions = {
    assertCanTriggerContentReview: async () => {
      if (options.denyTrigger) throw new ForbiddenException();
    },
    assertCanAccessVideo: async () => {
      if (options.denyAccess) throw new ForbiddenException();
    },
  } as unknown as PermissionsService;
  const operationLogs = {
    create: async (input: Record<string, unknown>) => {
      logs.push(input);
    },
  } as unknown as OperationLogsService;
  const client = {
    analyzeVideo: options.analyze || (async () => ({ rawResponse: successfulRawResponse })),
  };
  const service = new ContentReviewService(
    prisma,
    permissions,
    operationLogs,
    client as never,
    options.useDefaultScheduler ? undefined : (task) => tasks.push(task),
  );
  return { service, logs, updates, tasks, reviews, video };
}

test('content review rejects missing video with 404', async () => {
  const harness = createHarness({ missingVideo: true });
  await assert.rejects(
    harness.service.triggerContentReview(baseVideo.id, user, {}),
    NotFoundException,
  );
});

test('pinned content review is scoped to the video and omits raw output', async () => {
  const harness = createHarness();
  const id = '00000000-0000-4000-8000-000000000002';
  harness.reviews.push({ id, videoId: baseVideo.id, modelProvider: 'aliyun_bailian', modelName: 'test',
    status: AiReviewStatus.running, createdAt: new Date(), errorMessage: null, rawResponse: 'private', scores: [] });
  harness.reviews.push({ ...harness.reviews[0], id: '00000000-0000-4000-8000-000000000003' });
  const result = await harness.service.latest(baseVideo.id, user, {}, id);
  assert.equal(result.review?.id, id);
  assert.equal(Object.hasOwn(result.review!, 'rawResponse'), false);
  assert.equal(harness.logs.length, 0, 'polling should not create heartbeat audit rows');
  harness.reviews[0].videoId = 'another-video';
  await assert.rejects(harness.service.latest(baseVideo.id, user, {}, id), NotFoundException);
});

test('pinned content review enforces access and validates IDs', async () => {
  const id = '00000000-0000-4000-8000-000000000002';
  const denied = createHarness({ denyAccess: true });
  await assert.rejects(denied.service.latest(baseVideo.id, user, {}, id), ForbiddenException);
  await assert.rejects(createHarness().service.latest(baseVideo.id, user, {}, 'bad-id'), NotFoundException);
});

test('content review rejects unauthorized trigger with 403', async () => {
  const harness = createHarness({ denyTrigger: true });
  await assert.rejects(
    harness.service.triggerContentReview(baseVideo.id, user, {}),
    ForbiddenException,
  );
});

test('trigger returns running before Qwen background work starts', async () => {
  let analyzeStarted = false;
  const harness = createHarness({
    analyze: async () => {
      analyzeStarted = true;
      return { rawResponse: successfulRawResponse };
    },
  });

  const result = await harness.service.triggerContentReview(baseVideo.id, user, {});

  assert.equal(result.status, AiReviewStatus.running);
  assert.match(result.reviewId, /^review-/);
  assert.equal(analyzeStarted, false);
  assert.equal(harness.tasks.length, 1);
  assert.equal(harness.video.status, VideoStatus.ai_content_reviewing);
  const latest = await harness.service.latest(baseVideo.id, user, {});
  assert.equal(latest.review?.status, AiReviewStatus.running);
});

test('invalid video state returns 409', async () => {
  const harness = createHarness({ status: VideoStatus.pending_supervisor_review });
  await assert.rejects(
    harness.service.triggerContentReview(baseVideo.id, user, {}),
    ConflictException,
  );
});

test('fresh running content review returns 409', async () => {
  const harness = createHarness({
    status: VideoStatus.ai_content_reviewing,
    runningCreatedAt: new Date(),
  });
  await assert.rejects(
    harness.service.triggerContentReview(baseVideo.id, user, {}),
    ConflictException,
  );
});

test('stale running review is recovered and a new review is created', async () => {
  const harness = createHarness({
    status: VideoStatus.ai_content_reviewing,
    runningCreatedAt: new Date(Date.now() - 16 * 60_000),
  });

  const result = await harness.service.triggerContentReview(baseVideo.id, user, {});

  assert.equal(harness.reviews[0].status, AiReviewStatus.failed);
  assert.equal(harness.reviews[0].errorMessage, 'Recovered stale running content review.');
  assert.notEqual(result.reviewId, harness.reviews[0].id);
  assert.equal(harness.reviews.at(-1)?.status, AiReviewStatus.running);
  assert.ok(harness.logs.some((log) =>
    log.actionType === 'ai_content_review_recovered' &&
    log.targetId === harness.reviews[0].id &&
    log.result === 'failure'));
});

test('background success persists succeeded result and safe raw response', async () => {
  await withVideoFile(async () => {
    const harness = createHarness();
    const result = await harness.service.triggerContentReview(baseVideo.id, user, {});
    await harness.tasks[0]();

    const review = harness.reviews.find((item) => item.id === result.reviewId);
    assert.equal(review?.status, AiReviewStatus.succeeded);
    assert.equal(harness.video.status, VideoStatus.pending_supervisor_review);
    assert.deepEqual(review?.rawResponse, {
      usage: null,
      usageCollectionStatus: 'unknown',
      rawText: successfulRawResponse,
      parsed: successfulOutput,
    });
    assert.ok(harness.logs.some((log) =>
      log.actionType === 'ai_content_review_completed' && log.result === 'success'));
    const latest = await harness.service.latest(baseVideo.id, user, {});
    assert.equal(latest.review?.status, AiReviewStatus.succeeded);
  });
});

test('background failure persists failed review and video state', async () => {
  await withVideoFile(async () => {
    const harness = createHarness({
      analyze: async () => {
        throw new ContentReviewConfigurationError('key missing');
      },
    });
    const result = await harness.service.triggerContentReview(baseVideo.id, user, {});
    await harness.tasks[0]();

    const review = harness.reviews.find((item) => item.id === result.reviewId);
    assert.equal(review?.status, AiReviewStatus.failed);
    assert.equal(review?.errorMessage, 'Qwen content review is not configured.');
    assert.equal(harness.video.status, VideoStatus.ai_content_failed);
    assert.ok(harness.logs.some((log) =>
      log.actionType === 'ai_content_review_failed' && log.result === 'failure'));
    const latest = await harness.service.latest(baseVideo.id, user, {});
    assert.equal(latest.review?.status, AiReviewStatus.failed);
  });
});

test('schema failure after collector failure retains already received content usage evidence', async () => {
  await withVideoFile(async () => {
    const harness = createHarness({ analyze: async () => ({ rawResponse: '{invalid', usage: { inputTokens: 13, outputTokens: 7 }, usageCollectionStatus: 'failed' }) });
    const result = await harness.service.triggerContentReview(baseVideo.id, user, {}); await harness.tasks[0]();
    const review = harness.reviews.find(item => item.id === result.reviewId);
    assert.deepEqual(review?.rawResponse, { rawText: '{invalid', usage: { inputTokens: 13, outputTokens: 7 }, usageCollectionStatus: 'failed' });
  });
});

test('background persistence failure is contained without rejecting the scheduled task', async () => {
  await withVideoFile(async () => {
    const harness = createHarness({
      analyze: async () => {
        throw new ContentReviewConfigurationError('key missing');
      },
      failFailurePersistence: true,
    });
    await harness.service.triggerContentReview(baseVideo.id, user, {});
    await assert.doesNotReject(harness.tasks[0]());
  });
});

test('missing persistent queue fails closed before creating a review', async () => {
  const harness = createHarness({ useDefaultScheduler: true });
  await assert.rejects(harness.service.triggerContentReview(baseVideo.id, user, {}), /Persistent evaluation queue is required/);
  assert.equal(harness.reviews.length, 0);
  assert.equal(harness.tasks.length, 0);
});

test('latest content review omits rawResponse', async () => {
  await withVideoFile(async () => {
    const harness = createHarness();
    await harness.service.triggerContentReview(baseVideo.id, user, {});
    await harness.tasks[0]();

    const latest = await harness.service.latest(baseVideo.id, user, {});
    assert.ok(latest.review);
    assert.equal(Object.hasOwn(latest.review as object, 'rawResponse'), false);
  });
});

test('sanitization removes Qwen credentials', () => {
  const previousQwenKey = process.env.DASHSCOPE_API_KEY;
  process.env.DASHSCOPE_API_KEY = 'secret-qwen-key';
  try {
    const sanitized = sanitizeContentReviewText(
      'secret-qwen-key first Bearer token /Users/test/private.mp4',
    );
    assert.equal(sanitized?.includes('secret-qwen-key'), false);
    assert.equal(sanitized?.match(/\[redacted\]/g)?.length, 2);
    assert.equal(sanitized?.includes('/Users/test/private.mp4'), false);
  } finally {
    if (previousQwenKey === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = previousQwenKey;
  }
});
