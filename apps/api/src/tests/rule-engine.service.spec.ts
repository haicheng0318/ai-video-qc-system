import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AiReviewStatus, DataSufficiency, UserRole, VideoStatus } from '@prisma/client';
import { RuleEngineService } from '../modules/rule-engine/rule-engine.service';
import { PrismaService } from '../modules/prisma/prisma.service';

const videoId = '00000000-0000-4000-8000-000000000210';
const contentReviewId = '00000000-0000-4000-8000-000000000211';
const resultReviewId = '00000000-0000-4000-8000-000000000212';
const oldResultReviewId = '00000000-0000-4000-8000-000000000213';
const metricId = '00000000-0000-4000-8000-000000000214';
const oldMetricId = '00000000-0000-4000-8000-000000000215';
const actor = { id: 'admin', account: 'admin', name: 'Admin', role: UserRole.admin, managerId: null };

type Options = {
  status?: VideoStatus;
  missingVideo?: boolean;
  permissionDenied?: boolean;
  missingSupervisor?: boolean;
  supervisorDecision?: string;
  isAllowedToPublish?: boolean | null;
  missingContent?: boolean;
  contentAfterReview?: boolean;
  contentGrade?: unknown;
  resultStatus?: AiReviewStatus;
  dataGrade?: unknown;
  dataSufficiency?: DataSufficiency;
  missingResult?: boolean;
  foreignResult?: boolean;
  historicalResult?: boolean;
  missingMetricBinding?: boolean;
  foreignMetric?: boolean;
  staleMetric?: boolean;
  duplicate?: boolean;
  failResultCreate?: boolean;
  failLog?: boolean;
};

function createHarness(options: Options = {}) {
  const reviewedAt = new Date('2026-08-01T12:00:00.000Z');
  let video = {
    id: videoId,
    creatorId: 'director',
    status: options.status || VideoStatus.pending_rule_engine,
    creator: { managerId: null },
  };
  const supervisor = options.missingSupervisor ? null : {
    id: 'supervisor-review', videoId,
    decision: options.supervisorDecision || VideoStatus.approved_for_publish,
    isAllowedToPublish: options.isAllowedToPublish === undefined ? true : options.isAllowedToPublish,
    reviewedAt,
  };
  const contentReviews = options.missingContent ? [] : [{
    id: contentReviewId, videoId, status: AiReviewStatus.succeeded,
    contentGrade: options.contentGrade === undefined ? 'A' : options.contentGrade,
    createdAt: new Date(options.contentAfterReview ? '2026-08-01T13:00:00.000Z' : '2026-08-01T11:00:00.000Z'),
    rawResponse: { secret: true }, totalScore: 90,
  }];
  const reviews: Array<Record<string, any>> = options.missingResult ? [] : [
    ...(options.historicalResult ? [{
      id: oldResultReviewId, videoId, status: AiReviewStatus.succeeded,
      resultMetricId: oldMetricId, dataSufficiency: DataSufficiency.sufficient,
      dataGrade: 'B', createdAt: new Date('2026-08-01T14:00:00.000Z'),
    }] : []),
    {
      id: resultReviewId,
      videoId: options.foreignResult ? '00000000-0000-4000-8000-000000000299' : videoId,
      status: options.resultStatus || AiReviewStatus.succeeded,
      resultMetricId: options.missingMetricBinding ? null : metricId,
      dataSufficiency: options.dataSufficiency || DataSufficiency.sufficient,
      dataGrade: options.dataGrade === undefined ? 'B' : options.dataGrade,
      createdAt: new Date(options.historicalResult ? '2026-08-01T13:00:00.000Z' : '2026-08-01T15:00:00.000Z'),
      rawResponse: { secret: true }, dataScore: 75,
    },
    ...(options.historicalResult ? [{
      id: '00000000-0000-4000-8000-000000000216', videoId,
      status: AiReviewStatus.succeeded, resultMetricId: metricId,
      dataSufficiency: DataSufficiency.sufficient, dataGrade: 'A',
      createdAt: new Date('2026-08-01T16:00:00.000Z'),
    }] : []),
  ];
  const metrics = [
    { id: oldMetricId, videoId, createdAt: new Date('2026-08-01T13:00:00.000Z') },
    { id: metricId, videoId: options.foreignMetric ? '00000000-0000-4000-8000-000000000299' : videoId,
      createdAt: new Date(options.staleMetric ? '2026-08-01T14:00:00.000Z' : '2026-08-01T16:00:00.000Z') },
    ...(options.staleMetric ? [{
      id: '00000000-0000-4000-8000-000000000217', videoId,
      createdAt: new Date('2026-08-01T17:00:00.000Z'),
    }] : []),
  ];
  let ruleResults: Array<Record<string, any>> = options.duplicate ? [{
    id: '00000000-0000-4000-8000-000000000218', videoId, contentReviewId,
    resultReviewId, ruleVersion: 'rule-engine-v1', contentGrade: 'A', dataGrade: 'B',
    dataSufficiency: DataSufficiency.sufficient, ruleCode: 'R12_CONTENT_HIGH_DATA_MID',
    ruleResult: 'effective_candidate', ruleReason: 'historical immutable result',
    recommendedBoundary: 'allow_final_effective', createdAt: new Date('2026-08-01T18:00:00.000Z'),
  }] : [];
  let logs: Array<Record<string, any>> = [];
  let transactionCalls = 0;

  const newest = (items: Array<Record<string, any>>) => [...items].sort((a, b) =>
    b.createdAt.getTime() - a.createdAt.getTime() || String(b.id).localeCompare(String(a.id)));
  const matchesPage = (item: Record<string, any>, where: Record<string, any>) => {
    if (where.id && item.id !== where.id) return false;
    if (where.videoId && item.videoId !== where.videoId) return false;
    if (where.OR) return where.OR.some((part: Record<string, any>) =>
      part.createdAt?.lt ? item.createdAt < part.createdAt.lt :
        item.createdAt.getTime() === part.createdAt.getTime() && item.id < part.id.lt);
    return true;
  };
  const ruleClient = {
    findUnique: async ({ where }: { where: Record<string, any> }) => {
      const key = where.resultReviewId_ruleVersion;
      return key ? ruleResults.find((item) => item.resultReviewId === key.resultReviewId && item.ruleVersion === key.ruleVersion) || null : null;
    },
    findFirst: async ({ where, select }: { where: Record<string, any>; select?: Record<string, boolean> }) => {
      const found = newest(ruleResults).find((item) => matchesPage(item, where)) || null;
      return found && select ? Object.fromEntries(Object.keys(select).map((key) => [key, found[key]])) : found;
    },
    findMany: async ({ where, take }: { where: Record<string, any>; take: number }) =>
      newest(ruleResults).filter((item) => matchesPage(item, where)).slice(0, take),
    create: async ({ data }: { data: Record<string, any> }) => {
      if (options.failResultCreate) throw new Error('rule result create failed');
      const result = {
        id: `00000000-0000-4000-8000-${String(220 + ruleResults.length).padStart(12, '0')}`,
        ...data, createdAt: new Date('2026-08-01T19:00:00.000Z'),
      };
      ruleResults.push(result);
      return result;
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
    supervisorReview: { findUnique: async () => supervisor },
    aiContentReview: {
      findFirst: async () => contentReviews
        .filter((item) => item.videoId === videoId && item.status === AiReviewStatus.succeeded && item.createdAt <= reviewedAt)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] || null,
    },
    aiResultReview: {
      findUnique: async ({ where }: { where: { id: string } }) => reviews.find((item) => item.id === where.id) || null,
      findFirst: async ({ where }: { where: { videoId: string } }) => newest(reviews.filter((item) => item.videoId === where.videoId))[0] || null,
    },
    videoResultMetric: {
      findFirst: async ({ where }: { where: Record<string, any> }) => newest(metrics.filter((item) =>
        (!where.id || item.id === where.id) && (!where.videoId || item.videoId === where.videoId)))[0] || null,
    },
    ruleEngineResult: ruleClient,
  };
  let queue = Promise.resolve();
  const runTransaction = (callback: (client: typeof transaction) => Promise<unknown>) => {
    const run = async () => {
      transactionCalls += 1;
      const originalVideo = { ...video };
      const originalResults = ruleResults.map((item) => ({ ...item }));
      const originalLogs = logs.map((item) => ({ ...item }));
      try { return await callback(transaction); }
      catch (error) {
        video = originalVideo;
        ruleResults = originalResults;
        logs = originalLogs;
        throw error;
      }
    };
    const result = queue.then(run);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
  const prisma = {
    video: { findUnique: async () => options.missingVideo ? null : video },
    ruleEngineResult: ruleClient,
    $transaction: runTransaction,
  } as unknown as PrismaService;
  const permissions = {
    assertCanExecuteRuleEngine: async () => {
      if (options.permissionDenied) throw new ForbiddenException('denied');
    },
    assertCanAccessVideo: async () => undefined,
  };
  const operationLogs = {
    create: async (entry: Record<string, any>) => {
      if (options.failLog) throw new Error('operation log failed');
      logs.push(entry);
    },
  };
  const service = new RuleEngineService(prisma, permissions as never, operationLogs as never);
  return {
    service,
    execute: () => service.execute(videoId, { resultReviewId }, actor, { ipAddress: '127.0.0.1', userAgent: 'test-agent' }),
    getVideo: () => video,
    getResults: () => ruleResults,
    getLogs: () => logs,
    getTransactionCalls: () => transactionCalls,
  };
}

test('sufficient execution binds sources, creates immutable result, advances state and audits atomically', async () => {
  const harness = createHarness();
  const response = await harness.execute();
  assert.equal(response.videoStatus, VideoStatus.pending_final_evaluation);
  assert.equal(response.ruleEngineResult.contentReviewId, contentReviewId);
  assert.equal(response.ruleEngineResult.resultReviewId, resultReviewId);
  assert.equal(response.ruleEngineResult.ruleVersion, 'rule-engine-v1');
  assert.equal(response.ruleEngineResult.ruleCode, 'R12_CONTENT_HIGH_DATA_MID');
  assert.equal(harness.getResults().length, 1);
  assert.equal(harness.getLogs()[0].actionType, 'rule_engine_executed');
  assert.equal(harness.getLogs()[0].targetId, response.ruleEngineResult.id);
});

test('insufficient execution stores null data grade and advances to pending_data', async () => {
  const harness = createHarness({ dataSufficiency: DataSufficiency.insufficient, dataGrade: null });
  const response = await harness.execute();
  assert.equal(response.videoStatus, VideoStatus.pending_data);
  assert.equal(response.ruleEngineResult.ruleCode, 'R00_DATA_INSUFFICIENT');
  assert.equal(response.ruleEngineResult.dataGrade, null);
});

test('missing video returns 404 before transaction', async () => {
  const harness = createHarness({ missingVideo: true });
  await assert.rejects(harness.execute(), NotFoundException);
  assert.equal(harness.getTransactionCalls(), 0);
});

test('permission denial returns 403 before transaction and cannot create a result', async () => {
  const harness = createHarness({ permissionDenied: true });
  await assert.rejects(harness.execute(), ForbiddenException);
  assert.equal(harness.getTransactionCalls(), 0);
  assert.equal(harness.getResults().length, 0);
});

for (const status of Object.values(VideoStatus).filter((status) => status !== VideoStatus.pending_rule_engine)) {
  test(`${status} cannot execute the rule engine`, async () => {
    const harness = createHarness({ status });
    await assert.rejects(harness.execute(), ConflictException);
    assert.equal(harness.getResults().length, 0);
    assert.equal(harness.getVideo().status, status);
  });
}

test('missing supervisor review returns 404', async () => {
  await assert.rejects(createHarness({ missingSupervisor: true }).execute(), NotFoundException);
});

for (const decision of ['revision_required', 'invalid_content']) {
  test(`supervisor decision ${decision} blocks rule execution`, async () => {
    await assert.rejects(createHarness({ supervisorDecision: decision }).execute(), ConflictException);
  });
}

test('explicit supervisor publication denial blocks rule execution', async () => {
  await assert.rejects(createHarness({ isAllowedToPublish: false }).execute(), ConflictException);
});

test('missing succeeded content review returns 404', async () => {
  await assert.rejects(createHarness({ missingContent: true }).execute(), NotFoundException);
});

test('content review created after supervisor review is never used', async () => {
  await assert.rejects(createHarness({ contentAfterReview: true }).execute(), NotFoundException);
});

for (const contentGrade of [null, 'a', ' A ', 'E']) {
  test(`invalid persisted content grade ${String(contentGrade)} returns 422`, async () => {
    await assert.rejects(createHarness({ contentGrade }).execute(), UnprocessableEntityException);
  });
}

test('missing or foreign result review returns 404', async () => {
  await assert.rejects(createHarness({ missingResult: true }).execute(), NotFoundException);
  await assert.rejects(createHarness({ foreignResult: true }).execute(), NotFoundException);
});

for (const status of [AiReviewStatus.pending, AiReviewStatus.running, AiReviewStatus.failed]) {
  test(`${status} result review cannot execute the rule engine`, async () => {
    await assert.rejects(createHarness({ resultStatus: status }).execute(), ConflictException);
  });
}

test('historical result review returns 409', async () => {
  await assert.rejects(createHarness({ historicalResult: true }).execute(), ConflictException);
});

test('missing result metric binding returns 422', async () => {
  await assert.rejects(createHarness({ missingMetricBinding: true }).execute(), UnprocessableEntityException);
});

test('foreign bound metric returns 404', async () => {
  await assert.rejects(createHarness({ foreignMetric: true }).execute(), NotFoundException);
});

test('non-latest bound metric returns 409', async () => {
  await assert.rejects(createHarness({ staleMetric: true }).execute(), ConflictException);
});

test('duplicate result review and rule version returns 409 without mutation', async () => {
  const harness = createHarness({ duplicate: true });
  const before = JSON.stringify(harness.getResults());
  await assert.rejects(harness.execute(), ConflictException);
  assert.equal(JSON.stringify(harness.getResults()), before);
  assert.equal(harness.getVideo().status, VideoStatus.pending_rule_engine);
});

test('two concurrent executions produce one result and one success log', async () => {
  const harness = createHarness();
  const settled = await Promise.allSettled([harness.execute(), harness.execute()]);
  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(settled.filter((item) => item.status === 'rejected').length, 1);
  assert.equal(harness.getResults().length, 1);
  assert.equal(harness.getLogs().filter((log) => log.actionType === 'rule_engine_executed').length, 1);
});

for (const failure of ['result', 'log'] as const) {
  test(`${failure} persistence failure rolls back result, status and success log`, async () => {
    const harness = createHarness({ failResultCreate: failure === 'result', failLog: failure === 'log' });
    await assert.rejects(harness.execute());
    assert.equal(harness.getResults().length, 0);
    assert.equal(harness.getVideo().status, VideoStatus.pending_rule_engine);
    assert.equal(harness.getLogs().length, 0);
  });
}

test('operation log contains only bounded source and rule fields', async () => {
  const harness = createHarness();
  await harness.execute();
  const serialized = JSON.stringify(harness.getLogs()[0]);
  assert.match(serialized, /contentReviewId|resultReviewId|ruleVersion|ruleCode/);
  assert.doesNotMatch(serialized, /rawResponse|operatorNote|deliveryNote|attributionAnalysis|optimizationSuggestions|API_KEY/);
  assert.equal(harness.getLogs()[0].ipAddress, '127.0.0.1');
  assert.equal(harness.getLogs()[0].userAgent, 'test-agent');
});

test('latest returns null and never exposes source AI raw responses', async () => {
  const harness = createHarness();
  const empty = await harness.service.latest(videoId, actor, {});
  assert.equal(empty.ruleEngineResult, null);
  await harness.execute();
  const latest = await harness.service.latest(videoId, actor, {});
  assert.equal(latest.ruleEngineResult?.resultReviewId, resultReviewId);
  assert.equal(Object.hasOwn(latest.ruleEngineResult || {}, 'rawResponse'), false);
});

test('history is newest-first, marks latest and paginates without exposing raw data', async () => {
  const harness = createHarness();
  await harness.execute();
  const first = await harness.service.history(videoId, { limit: 1 }, actor, {});
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].isLatest, true);
  assert.equal(first.nextCursor, null);
  assert.equal(Object.hasOwn(first.items[0], 'rawResponse'), false);
});

test('history rejects a cross-video or unknown cursor', async () => {
  const harness = createHarness();
  await assert.rejects(
    harness.service.history(videoId, { limit: 20, cursor: '00000000-0000-4000-8000-000000000299' }, actor, {}),
    BadRequestException,
  );
});
