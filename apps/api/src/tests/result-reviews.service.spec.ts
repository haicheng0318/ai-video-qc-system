import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AiReviewStatus, DataSufficiency, Prisma, UserRole, VideoStatus, VideoType } from '@prisma/client';
import { ResultReviewsService, sanitizeOpenAiText } from '../modules/result-reviews/result-reviews.service';
import { ResultReviewOutput } from '../modules/ai/gpt/gpt-result-review.schema';
import { PrismaService } from '../modules/prisma/prisma.service';

const videoId = '00000000-0000-4000-8000-000000000060';
const metricId = '00000000-0000-4000-8000-000000000061';
const oldMetricId = '00000000-0000-4000-8000-000000000062';
const actor = {
  id: '00000000-0000-4000-8000-000000000063', account: 'admin', name: 'Admin',
  role: UserRole.admin, managerId: null,
};

const sufficientOutput: ResultReviewOutput = {
  dataSufficiency: 'sufficient', sufficiencyReasons: [], dataScore: 85, dataGrade: 'A',
  isBusinessEffectiveRecommendation: true, resultSummary: 'Structured business result summary.',
  performanceProblems: [{
    metric: 'ctr', severity: 'medium', observedValue: '2.5', benchmarkValue: '3.0',
    description: 'CTR is below the configured benchmark.',
  }],
  attributionAnalysis: [{
    type: 'delivery', confidence: 70, evidence: ['CTR is below the configured benchmark.'],
    conclusion: 'Delivery configuration may need refinement.',
  }],
  optimizationSuggestions: [{
    priority: 'high', owner: 'delivery', action: 'Refine delivery targeting.',
    rationale: 'Improve qualified traffic before drawing content conclusions.',
  }],
  continueTestRecommendation: 'optimize_then_continue',
};

const insufficientOutput: ResultReviewOutput = {
  dataSufficiency: 'insufficient',
  sufficiencyReasons: [{
    code: 'missing_benchmark', description: 'No applicable business benchmark is configured.',
    requiredNextData: ['Configure an approved benchmark.'],
  }],
  dataScore: null, dataGrade: null, isBusinessEffectiveRecommendation: null,
  resultSummary: 'Evidence is insufficient for scoring.', performanceProblems: [],
  attributionAnalysis: [{
    type: 'sample_size', confidence: 100, evidence: ['No benchmark is available.'],
    conclusion: 'Collect approved benchmark data before scoring.',
  }],
  optimizationSuggestions: [], continueTestRecommendation: 'collect_more_data',
};

type HarnessOptions = {
  status?: VideoStatus;
  missingVideo?: boolean;
  missingMetric?: boolean;
  oldMetric?: boolean;
  freshRunning?: boolean;
  staleRunning?: boolean;
  succeeded?: boolean;
  failedHistory?: boolean;
  failGpt?: boolean;
  failLogAction?: string;
  output?: ResultReviewOutput;
  noBenchmarks?: boolean;
  modelConfig?: { modelName: string; maxTokens: number | null };
};

function createHarness(options: HarnessOptions = {}) {
  let video = {
    id: videoId, creatorId: 'director', status: options.status || VideoStatus.pending_result_data,
    videoType: VideoType.qianchuan_ad, isForAds: true, platform: 'douyin', brand: 'Brand',
    product: 'Product', isEventVideo: false, eventName: null, creator: { managerId: null },
  };
  const now = Date.now();
  const metrics = [
    {
      id: oldMetricId, videoId, videoType: VideoType.qianchuan_ad,
      dataStartDate: new Date('2026-07-01'), dataEndDate: new Date('2026-07-02'),
      impressions: 10, clicks: 1, spend: new Prisma.Decimal('5.00'), createdAt: new Date(now - 2000),
    },
    ...(!options.missingMetric ? [{
      id: metricId, videoId, videoType: VideoType.qianchuan_ad,
      dataStartDate: new Date('2026-07-01'), dataEndDate: new Date('2026-07-03'),
      impressions: 100, clicks: 3, ctr: new Prisma.Decimal('3.0'), spend: new Prisma.Decimal('50.00'),
      operatorNote: 'untrusted result note', createdAt: new Date(now - 1000),
    }] : []),
  ];
  let reviewSequence = 70;
  let reviews: Array<Record<string, any>> = [];
  if (options.freshRunning || options.staleRunning) {
    reviews.push({
      id: `00000000-0000-4000-8000-${String(reviewSequence++).padStart(12, '0')}`,
      videoId, resultMetricId: metricId, modelProvider: 'openai', modelName: 'gpt-5-mini',
      status: AiReviewStatus.running, dataSufficiency: DataSufficiency.pending,
      createdAt: new Date(now - (options.staleRunning ? 11 * 60_000 : 60_000)), rawResponse: null,
    });
  }
  if (options.succeeded || options.failedHistory) {
    reviews.push({
      id: `00000000-0000-4000-8000-${String(reviewSequence++).padStart(12, '0')}`,
      videoId, resultMetricId: metricId, modelProvider: 'openai', modelName: 'gpt-5-mini',
      status: options.succeeded ? AiReviewStatus.succeeded : AiReviewStatus.failed,
      dataSufficiency: options.succeeded ? DataSufficiency.sufficient : DataSufficiency.pending,
      dataScore: options.succeeded ? 85 : null, dataGrade: options.succeeded ? 'A' : null,
      errorMessage: options.failedHistory ? 'Safe failure.' : null,
      createdAt: new Date(now - 30_000), rawResponse: null,
    });
  }
  let logs: Array<Record<string, any>> = [];
  const scheduled: Array<() => Promise<void>> = [];
  let gptCalls = 0;

  const sortReviews = (items = reviews) => [...items].sort((a, b) =>
    b.createdAt.getTime() - a.createdAt.getTime() || String(b.id).localeCompare(String(a.id)));
  const matchesReview = (item: Record<string, any>, where: Record<string, any>) => {
    if (where.id && item.id !== where.id) return false;
    if (where.videoId && item.videoId !== where.videoId) return false;
    if (where.resultMetricId && item.resultMetricId !== where.resultMetricId) return false;
    if (where.status && item.status !== where.status) return false;
    if (where.OR) return where.OR.some((part: Record<string, any>) => {
      if (part.createdAt?.lt) return item.createdAt < part.createdAt.lt;
      return item.createdAt.getTime() === part.createdAt.getTime() && item.id < part.id.lt;
    });
    return true;
  };
  const reviewClient = {
    findMany: async ({ where, take }: { where: Record<string, any>; take?: number }) =>
      sortReviews().filter((item) => matchesReview(item, where)).slice(0, take),
    findFirst: async ({ where, select }: { where: Record<string, any>; select?: Record<string, boolean> }) => {
      const found = sortReviews().find((item) => matchesReview(item, where)) || null;
      return found && select ? Object.fromEntries(Object.keys(select).map((key) => [key, found[key]])) : found;
    },
    findUnique: async ({ where }: { where: { id: string } }) => reviews.find((item) => item.id === where.id) || null,
    create: async ({ data }: { data: Record<string, any> }) => {
      const created = {
        id: `00000000-0000-4000-8000-${String(reviewSequence++).padStart(12, '0')}`,
        ...data, createdAt: new Date(now + reviewSequence), rawResponse: null, errorMessage: null,
      };
      reviews.push(created);
      return created;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
      const index = reviews.findIndex((item) => item.id === where.id);
      reviews[index] = { ...reviews[index], ...data };
      return reviews[index];
    },
  };
  const metricClient = {
    findFirst: async ({ where }: { where: Record<string, any> }) => {
      const candidates = metrics.filter((metric) =>
        (!where.id || metric.id === where.id) && (!where.videoId || metric.videoId === where.videoId));
      return [...candidates].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))[0] || null;
    },
  };
  const transaction = {
    $queryRaw: async () => [],
    video: {
      findUnique: async () => options.missingVideo ? null : video,
      update: async ({ data }: { data: { status: VideoStatus } }) => {
        video = { ...video, status: data.status };
        return video;
      },
    },
    videoResultMetric: metricClient,
    aiResultReview: reviewClient,
    aiModelConfig: {
      findFirst: async () => options.modelConfig ? { ...options.modelConfig, createdAt: new Date() } : null,
    },
  };
  let transactionQueue = Promise.resolve();
  const runTransaction = (callback: (client: typeof transaction) => Promise<unknown>) => {
    const run = async () => {
      const originalVideo = video;
      const originalReviews = reviews.map((item) => ({ ...item }));
      const originalLogs = logs.map((item) => ({ ...item }));
      try {
        return await callback(transaction);
      } catch (error) {
        video = originalVideo;
        reviews = originalReviews;
        logs = originalLogs;
        throw error;
      }
    };
    const result = transactionQueue.then(run);
    transactionQueue = result.then(() => undefined, () => undefined);
    return result;
  };
  const prisma = {
    video: { findUnique: async () => options.missingVideo ? null : video },
    videoResultMetric: metricClient,
    aiResultReview: reviewClient,
    aiContentReview: { findFirst: async () => ({ contentGrade: 'A', totalScore: 82, rawResponse: { secret: true } }) },
    supervisorReview: { findUnique: async () => ({ decision: 'approved_for_publish', comment: 'Approved.' }) },
    platformBenchmark: { findMany: async () => options.noBenchmarks ? [] : [{
      platform: 'douyin', brand: 'Brand', videoType: VideoType.qianchuan_ad, metricName: 'impressions',
      sThreshold: new Prisma.Decimal(100), aThreshold: new Prisma.Decimal(80),
      bThreshold: new Prisma.Decimal(60), cThreshold: new Prisma.Decimal(40), direction: 'higher_is_better',
    }] },
    $transaction: runTransaction,
  } as unknown as PrismaService;
  const permissions = {
    assertCanTriggerResultReview: async () => undefined,
    assertCanAccessVideo: async () => undefined,
  };
  const operationLogs = {
    create: async (entry: Record<string, any>) => {
      if (options.failLogAction === entry.actionType) throw new Error('operation log failed');
      logs.push(entry);
    },
  };
  const gpt = {
    reviewResultData: async () => {
      gptCalls += 1;
      if (options.failGpt) throw new Error(`sdk failure ${process.env.OPENAI_API_KEY || ''}`);
      const output = options.output || (options.noBenchmarks ? insufficientOutput : sufficientOutput);
      return {
        responseId: 'resp-1', responseStatus: 'completed', model: 'gpt-5-mini',
        rawText: JSON.stringify(output), usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
        parsedOutput: output,
      };
    },
  };
  const service = new ResultReviewsService(
    prisma, permissions as never, operationLogs as never, gpt as never,
    (task) => { scheduled.push(task); },
  );
  return {
    service, scheduled,
    trigger: () => service.trigger(videoId, { resultMetricId: options.oldMetric ? oldMetricId : metricId }, actor, {}),
    runBackground: async () => { const task = scheduled.shift(); assert.ok(task); await task(); },
    getVideo: () => video,
    getReviews: () => reviews,
    getLogs: () => logs,
    getGptCalls: () => gptCalls,
  };
}

test('trigger returns immediately with running and binds the latest metric', async () => {
  const harness = createHarness();
  const result = await harness.trigger();
  assert.equal(result.status, AiReviewStatus.running);
  assert.equal(result.resultMetricId, metricId);
  assert.equal(harness.getVideo().status, VideoStatus.ai_result_reviewing);
  assert.equal(harness.getGptCalls(), 0);
  assert.equal(harness.scheduled.length, 1);
  assert.equal(harness.getLogs()[0].actionType, 'ai_result_review_started');
});

test('missing video and missing snapshot return 404', async () => {
  await assert.rejects(createHarness({ missingVideo: true }).trigger(), NotFoundException);
  await assert.rejects(createHarness({ missingMetric: true }).trigger(), NotFoundException);
});

test('historical snapshot returns 409 and creates no review', async () => {
  const harness = createHarness({ oldMetric: true });
  await assert.rejects(harness.trigger(), ConflictException);
  assert.equal(harness.getReviews().length, 0);
});

for (const status of [
  VideoStatus.approved_for_publish, VideoStatus.pending_data, VideoStatus.revision_required,
  VideoStatus.invalid_content, VideoStatus.ai_result_reviewing, VideoStatus.pending_rule_engine,
  VideoStatus.final_effective,
]) {
  test(`${status} cannot trigger GPT result review`, async () => {
    await assert.rejects(createHarness({ status }).trigger(), ConflictException);
  });
}

test('ai_result_failed can create a new retry without overwriting failed history', async () => {
  const harness = createHarness({ status: VideoStatus.ai_result_failed, failedHistory: true });
  const before = { ...harness.getReviews()[0] };
  await harness.trigger();
  assert.equal(harness.getReviews().length, 2);
  assert.deepEqual(harness.getReviews()[0], before);
});

test('fresh running review returns 409 and never schedules OpenAI', async () => {
  const harness = createHarness({ status: VideoStatus.ai_result_reviewing, freshRunning: true });
  await assert.rejects(harness.trigger(), ConflictException);
  assert.equal(harness.scheduled.length, 0);
  assert.equal(harness.getGptCalls(), 0);
});

test('stale running review is recovered, logged and replaced atomically', async () => {
  const harness = createHarness({ status: VideoStatus.ai_result_reviewing, staleRunning: true });
  await harness.trigger();
  assert.equal(harness.getReviews()[0].status, AiReviewStatus.failed);
  assert.equal(harness.getReviews()[0].errorMessage, 'Recovered stale running result review.');
  assert.equal(harness.getReviews().length, 2);
  assert.deepEqual(harness.getLogs().map((log) => log.actionType), [
    'ai_result_review_recovered', 'ai_result_review_started',
  ]);
});

test('two concurrent triggers create only one running review', async () => {
  const harness = createHarness();
  const results = await Promise.allSettled([harness.trigger(), harness.trigger()]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(harness.getReviews().filter((review) => review.status === AiReviewStatus.running).length, 1);
});

test('existing succeeded result for the same snapshot returns 409', async () => {
  await assert.rejects(createHarness({ succeeded: true }).trigger(), ConflictException);
});

test('database-configured model and max tokens take priority', async () => {
  const originalModel = process.env.OPENAI_RESULT_REVIEW_MODEL;
  process.env.OPENAI_RESULT_REVIEW_MODEL = 'env-model';
  try {
    const harness = createHarness({ modelConfig: { modelName: 'db-model', maxTokens: 1234 } });
    await harness.trigger();
    const running = harness.getReviews().find((review) => review.status === AiReviewStatus.running);
    assert.equal(running?.modelName, 'db-model');
    assert.equal(harness.getLogs()[0].afterValue.modelName, 'db-model');
  } finally {
    if (originalModel === undefined) delete process.env.OPENAI_RESULT_REVIEW_MODEL;
    else process.env.OPENAI_RESULT_REVIEW_MODEL = originalModel;
  }
});

test('successful background review persists fields, audit, status and log in one transaction', async () => {
  const harness = createHarness();
  await harness.trigger();
  await harness.runBackground();
  const review = harness.getReviews()[0];
  assert.equal(review.status, AiReviewStatus.succeeded);
  assert.equal(review.resultMetricId, metricId);
  assert.equal(review.dataScore, 85);
  assert.equal(review.dataGrade, 'A');
  assert.equal(review.dataSufficiency, DataSufficiency.sufficient);
  assert.equal(review.rawResponse.responseId, 'resp-1');
  assert.equal(review.rawResponse.usage.totalTokens, 70);
  assert.equal(review.rawResponse.parsed.resultSummary, sufficientOutput.resultSummary);
  assert.equal(harness.getVideo().status, VideoStatus.pending_rule_engine);
  assert.equal(harness.getLogs().at(-1)?.actionType, 'ai_result_review_completed');
});

test('no benchmark forces an auditable insufficient result with null score and grade', async () => {
  const harness = createHarness({ noBenchmarks: true });
  await harness.trigger();
  await harness.runBackground();
  const review = harness.getReviews()[0];
  assert.equal(review.status, AiReviewStatus.succeeded);
  assert.equal(review.dataSufficiency, DataSufficiency.insufficient);
  assert.equal(review.dataScore, null);
  assert.equal(review.dataGrade, null);
  assert.equal(review.rawResponse.benchmarkCoverage, 'none');
  assert.equal(review.rawResponse.parsed.sufficiencyReasons[0].code, 'missing_benchmark');
});

test('OpenAI failure persists a safe message and ai_result_failed without leaking the key', async () => {
  const original = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'secret-key-for-test';
  try {
    const harness = createHarness({ failGpt: true });
    await harness.trigger();
    await harness.runBackground();
    const review = harness.getReviews()[0];
    assert.equal(review.status, AiReviewStatus.failed);
    assert.equal(review.errorMessage, 'GPT result review failed.');
    assert.doesNotMatch(JSON.stringify(review), /secret-key-for-test/);
    assert.equal(harness.getVideo().status, VideoStatus.ai_result_failed);
    assert.equal(harness.getLogs().at(-1)?.actionType, 'ai_result_review_failed');
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
});

test('completed operation log failure rolls back succeeded review and pending_rule_engine', async () => {
  const harness = createHarness({ failLogAction: 'ai_result_review_completed' });
  await harness.trigger();
  await harness.runBackground();
  const review = harness.getReviews()[0];
  assert.equal(review.status, AiReviewStatus.failed);
  assert.equal(harness.getVideo().status, VideoStatus.ai_result_failed);
});

test('latest returns null without reviews and never exposes rawResponse', async () => {
  const empty = await createHarness().service.latest(videoId, actor, {});
  assert.equal(empty.review, null);
  const harness = createHarness({ succeeded: true });
  harness.getReviews()[0].rawResponse = { secretAudit: true };
  const latest = await harness.service.latest(videoId, actor, {});
  assert.equal(latest.review?.status, AiReviewStatus.succeeded);
  assert.equal(Object.hasOwn(latest.review || {}, 'rawResponse'), false);
});

test('history retains failed and succeeded reviews, is newest-first and marks latest', async () => {
  const harness = createHarness({ succeeded: true, failedHistory: true });
  harness.getReviews().push({
    ...harness.getReviews()[0],
    id: '00000000-0000-4000-8000-000000000099', status: AiReviewStatus.failed,
    createdAt: new Date(Date.now() + 1000), resultMetric: null,
  });
  const history = await harness.service.history(videoId, { limit: 20 }, actor, {});
  assert.equal(history.items.length, 2);
  assert.equal(history.items[0].status, AiReviewStatus.failed);
  assert.equal(history.items[0].isLatest, true);
  assert.equal(history.items[1].status, AiReviewStatus.succeeded);
  assert.ok(!('rawResponse' in history.items[0]));
});

test('OpenAI audit sanitizer removes every secret, credential URL, path and signed query value', () => {
  const original = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'openai-secret';
  try {
    const sanitized = sanitizeOpenAiText(
      'openai-secret openai-secret Bearer abc123 postgresql://user:pass@host/db ' +
      '/Users/name/private.txt https://example.test/path?token=abc&signature=def',
    ) || '';
    assert.doesNotMatch(sanitized, /openai-secret|abc123|user:pass|\/Users\/name|token=abc|signature=def/);
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
});
