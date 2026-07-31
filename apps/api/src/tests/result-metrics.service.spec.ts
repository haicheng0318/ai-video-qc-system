import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole, VideoStatus, VideoType } from '@prisma/client';
import { ResultMetricsService } from '../modules/result-metrics/result-metrics.service';
import { PrismaService } from '../modules/prisma/prisma.service';
import { AuthenticatedUser } from '../types/authenticated-user';

const videoId = '00000000-0000-4000-8000-000000000040';
const actor: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000041',
  account: 'admin',
  name: 'Admin',
  role: UserRole.admin,
  managerId: null,
};

function metricId(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function baseInput(videoType: VideoType = VideoType.product_card): Record<string, any> {
  const common = {
    dataStartDate: '2026-07-31',
    dataEndDate: '2026-08-02',
  };
  switch (videoType) {
    case VideoType.qianchuan_ad:
      return { ...common, impressions: 0, spend: 0, ctr: 0, roi: 0 };
    case VideoType.live_room_traffic:
      return { ...common, liveRoomEntries: 0, spend: 0 };
    case VideoType.organic:
      return { ...common, views: 0, likes: 0 };
    case VideoType.brand_seeding:
      return { ...common, views: 0, followersGain: 0 };
    case VideoType.other:
      return { ...common, views: 0 };
    default:
      return { ...common, views: 0, gmv: 0 };
  }
}

function createHarness(options: {
  videoType?: VideoType;
  isForAds?: boolean;
  status?: VideoStatus;
  missingVideo?: boolean;
  failLog?: boolean;
  serialTransactions?: boolean;
} = {}) {
  const video = {
    id: videoId,
    title: 'Video',
    videoType: options.videoType || VideoType.product_card,
    isForAds: options.isForAds ?? false,
    creatorId: 'director-id',
    status: options.status || VideoStatus.approved_for_publish,
    creator: { managerId: 'supervisor-id' },
  };
  let metrics: Array<Record<string, any>> = [];
  let logs: Array<Record<string, any>> = [];
  let sequence = 1;

  const sorted = () => [...metrics].sort((a, b) => {
    const dateDifference = b.createdAt.getTime() - a.createdAt.getTime();
    return dateDifference || String(b.id).localeCompare(String(a.id));
  });
  const matchesHistoryWhere = (item: Record<string, any>, where: Record<string, any>) => {
    if (where.id && item.id !== where.id) return false;
    if (where.videoId && item.videoId !== where.videoId) return false;
    if (!where.OR) return true;
    return where.OR.some((condition: Record<string, any>) => {
      if (condition.createdAt?.lt) return item.createdAt < condition.createdAt.lt;
      return (
        condition.createdAt === item.createdAt &&
        item.id < condition.id.lt
      );
    });
  };
  const metricClient = {
    findFirst: async ({ where, select }: { where: Record<string, any>; select?: Record<string, boolean> }) => {
      const item = sorted().find((candidate) => matchesHistoryWhere(candidate, where)) || null;
      if (!item || !select) return item;
      return Object.fromEntries(Object.keys(select).map((key) => [key, item[key]]));
    },
    findMany: async ({ where, take }: { where: Record<string, any>; take: number }) =>
      sorted().filter((item) => matchesHistoryWhere(item, where)).slice(0, take),
    create: async ({ data }: { data: Record<string, any> }) => {
      const created = {
        id: metricId(sequence),
        ...data,
        createdAt: new Date(Date.UTC(2026, 7, sequence, 0, 0, 0, sequence)),
        updatedAt: new Date(Date.UTC(2026, 7, sequence, 0, 0, 0, sequence)),
        submitter: {
          id: actor.id,
          name: actor.name,
          account: actor.account,
          role: actor.role,
        },
      };
      sequence += 1;
      metrics.push(created);
      return created;
    },
  };
  const transaction = {
    $queryRaw: async () => [],
    video: {
      findUnique: async () => options.missingVideo ? null : video,
      update: async ({ data }: { data: { status: VideoStatus } }) => {
        video.status = data.status;
        return video;
      },
    },
    videoResultMetric: metricClient,
  };

  const run = async (callback: (client: typeof transaction) => Promise<unknown>) => {
    const beforeMetrics = metrics.map((item) => ({ ...item }));
    const beforeLogs = logs.map((item) => ({ ...item }));
    const beforeStatus = video.status;
    try {
      return await callback(transaction);
    } catch (error) {
      metrics = beforeMetrics;
      logs = beforeLogs;
      video.status = beforeStatus;
      throw error;
    }
  };
  let queue = Promise.resolve();
  const runTransaction = (callback: (client: typeof transaction) => Promise<unknown>) => {
    if (!options.serialTransactions) return run(callback);
    const result = queue.then(() => run(callback));
    queue = result.then(() => undefined, () => undefined);
    return result;
  };

  const prisma = {
    video: {
      findUnique: async () => options.missingVideo ? null : video,
    },
    videoResultMetric: metricClient,
    $transaction: runTransaction,
  } as unknown as PrismaService;
  const permissions = {
    assertCanSubmitResultMetrics: async () => undefined,
    assertCanAccessVideo: async () => undefined,
  };
  const operationLogs = {
    create: async (input: Record<string, any>) => {
      if (options.failLog) throw new Error('operation log failed');
      logs.push(input);
    },
  };
  const service = new ResultMetricsService(prisma, permissions as never, operationLogs as never);
  return {
    service,
    video,
    getMetrics: () => metrics,
    getLogs: () => logs,
  };
}

test('missing video returns 404', async () => {
  await assert.rejects(
    createHarness({ missingVideo: true }).service.createSnapshot(
      videoId,
      baseInput(),
      actor,
      {},
    ),
    NotFoundException,
  );
});

test('approved_for_publish first submission creates a snapshot and advances status', async () => {
  const harness = createHarness();
  const result = await harness.service.createSnapshot(videoId, baseInput(), actor, {});
  assert.equal(harness.getMetrics().length, 1);
  assert.equal(result.videoStatus, VideoStatus.pending_result_data);
  assert.equal(harness.video.status, VideoStatus.pending_result_data);
});

for (const status of [
  VideoStatus.pending_result_data,
  VideoStatus.ai_result_failed,
  VideoStatus.pending_data,
]) {
  test(`${status} can create a result metric snapshot and returns to pending_result_data`, async () => {
    const harness = createHarness({ status });
    await harness.service.createSnapshot(videoId, baseInput(), actor, {});
    assert.equal(harness.video.status, VideoStatus.pending_result_data);
  });
}

for (const status of [
  VideoStatus.ai_content_reviewing,
  VideoStatus.ai_content_failed,
  VideoStatus.pending_supervisor_review,
  VideoStatus.revision_required,
  VideoStatus.invalid_content,
  VideoStatus.submitted,
  VideoStatus.ai_result_reviewing,
  VideoStatus.pending_rule_engine,
  VideoStatus.pending_final_evaluation,
  VideoStatus.final_evaluation_failed,
  VideoStatus.pending_final_confirmation,
  VideoStatus.final_effective,
  VideoStatus.final_low_effective,
  VideoStatus.final_invalid,
  VideoStatus.excellent_case,
  VideoStatus.negative_case,
]) {
  test(`${status} rejects result metric submission with 409`, async () => {
    await assert.rejects(
      createHarness({ status }).service.createSnapshot(videoId, baseInput(), actor, {}),
      ConflictException,
    );
  });
}

test('second submission creates a new immutable snapshot and inherits omitted fields', async () => {
  const harness = createHarness();
  const first = await harness.service.createSnapshot(videoId, {
    ...baseInput(),
    publishUrl: 'https://example.com/video/1',
    views: 100,
    operatorNote: 'first',
  }, actor, {});
  const firstRecord = { ...harness.getMetrics()[0] };
  const second = await harness.service.createSnapshot(videoId, {
    baseMetricId: first.id,
    dataEndDate: '2026-08-03',
    views: 200,
  }, actor, {});
  assert.equal(harness.getMetrics().length, 2);
  assert.deepEqual(harness.getMetrics()[0], firstRecord);
  assert.equal(second.publishUrl, 'https://example.com/video/1');
  assert.equal(second.operatorNote, 'first');
  assert.equal(second.views, 200);
});

test('undefined DTO class fields inherit the latest snapshot instead of clearing it', async () => {
  const harness = createHarness();
  const first = await harness.service.createSnapshot(videoId, baseInput(), actor, {});
  const second = await harness.service.createSnapshot(
    videoId,
    {
      baseMetricId: first.id,
      dataStartDate: undefined,
      dataEndDate: undefined,
      views: 5,
    },
    actor,
    {},
  );
  assert.equal(second.dataStartDate, '2026-07-31');
  assert.equal(second.dataEndDate, '2026-08-02');
  assert.equal(second.views, 5);
});

test('explicit null clears an optional inherited field', async () => {
  const harness = createHarness();
  const first = await harness.service.createSnapshot(videoId, {
    ...baseInput(),
    operatorNote: 'clear me',
  }, actor, {});
  const second = await harness.service.createSnapshot(videoId, {
    baseMetricId: first.id,
    operatorNote: null,
  }, actor, {});
  assert.equal(second.operatorNote, null);
  assert.equal(harness.getMetrics()[0].operatorNote, 'clear me');
});

test('videoType and submittedBy always come from server-owned context', async () => {
  const harness = createHarness({ videoType: VideoType.organic });
  const result = await harness.service.createSnapshot(
    videoId,
    baseInput(VideoType.organic),
    actor,
    {},
  );
  assert.equal(result.videoType, VideoType.organic);
  assert.equal(result.submittedBy?.id, actor.id);
  assert.equal(harness.getMetrics()[0].submittedBy, actor.id);
});

test('latest returns the newest snapshot and previousMetricId', async () => {
  const harness = createHarness();
  const first = await harness.service.createSnapshot(videoId, { ...baseInput(), views: 10 }, actor, {});
  const second = await harness.service.createSnapshot(videoId, {
    baseMetricId: first.id,
    views: 20,
  }, actor, {});
  const latest = await harness.service.latest(videoId, actor, {});
  assert.equal(latest?.id, second.id);
  assert.equal(latest?.previousMetricId, first.id);
  assert.equal(latest?.views, 20);
});

test('latest returns null when the video has no snapshots', async () => {
  assert.equal(await createHarness().service.latest(videoId, actor, {}), null);
});

test('history is newest-first, marks latest and paginates with cursor', async () => {
  const harness = createHarness();
  const first = await harness.service.createSnapshot(videoId, { ...baseInput(), views: 10 }, actor, {});
  const second = await harness.service.createSnapshot(videoId, { baseMetricId: first.id, views: 20 }, actor, {});
  const third = await harness.service.createSnapshot(videoId, { baseMetricId: second.id, views: 30 }, actor, {});
  const page1 = await harness.service.history(videoId, { limit: 2 }, actor, {});
  assert.deepEqual(page1.items.map((item) => item.id), [third.id, second.id]);
  assert.equal(page1.items[0].isLatest, true);
  assert.equal(page1.nextCursor, second.id);
  const page2 = await harness.service.history(videoId, { limit: 2, cursor: second.id }, actor, {});
  assert.deepEqual(page2.items.map((item) => item.id), [first.id]);
  assert.equal(page2.nextCursor, null);
});

test('invalid history cursor returns 400', async () => {
  await assert.rejects(
    createHarness().service.history(videoId, { limit: 20, cursor: metricId(99) }, actor, {}),
    BadRequestException,
  );
});

test('existing snapshot requires the current baseMetricId', async () => {
  const harness = createHarness();
  await harness.service.createSnapshot(videoId, baseInput(), actor, {});
  await assert.rejects(
    harness.service.createSnapshot(videoId, { views: 2 }, actor, {}),
    ConflictException,
  );
  assert.equal(harness.getMetrics().length, 1);
});

test('stale baseMetricId returns 409 without creating a record or changing status', async () => {
  const harness = createHarness();
  const first = await harness.service.createSnapshot(videoId, baseInput(), actor, {});
  await harness.service.createSnapshot(videoId, { baseMetricId: first.id, views: 2 }, actor, {});
  const statusBefore = harness.video.status;
  await assert.rejects(
    harness.service.createSnapshot(videoId, { baseMetricId: first.id, views: 3 }, actor, {}),
    ConflictException,
  );
  assert.equal(harness.getMetrics().length, 2);
  assert.equal(harness.video.status, statusBefore);
});

test('two concurrent submissions with one baseMetricId allow only one commit', async () => {
  const harness = createHarness({ serialTransactions: true });
  const first = await harness.service.createSnapshot(videoId, baseInput(), actor, {});
  const results = await Promise.allSettled([
    harness.service.createSnapshot(videoId, { baseMetricId: first.id, views: 2 }, actor, {}),
    harness.service.createSnapshot(videoId, { baseMetricId: first.id, views: 3 }, actor, {}),
  ]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(results.filter((item) => item.status === 'rejected').length, 1);
  assert.equal(harness.getMetrics().length, 2);
});

test('operation log is written with snapshot in the same transaction', async () => {
  const harness = createHarness();
  const result = await harness.service.createSnapshot(videoId, baseInput(), actor, {});
  assert.equal(harness.getLogs().length, 1);
  assert.equal(harness.getLogs()[0].actionType, 'result_metric_snapshot_created');
  assert.equal(harness.getLogs()[0].targetId, result.id);
  assert.deepEqual(harness.getLogs()[0].afterValue.changedFields.sort(), [
    'dataEndDate',
    'dataStartDate',
    'gmv',
    'views',
  ]);
});

test('operation log failure rolls back snapshot and video status', async () => {
  const harness = createHarness({ failLog: true });
  await assert.rejects(
    harness.service.createSnapshot(videoId, baseInput(), actor, {}),
    /operation log failed/,
  );
  assert.equal(harness.getMetrics().length, 0);
  assert.equal(harness.video.status, VideoStatus.approved_for_publish);
});

test('field outside the video type configuration returns 400', async () => {
  await assert.rejects(
    createHarness({ videoType: VideoType.organic }).service.createSnapshot(
      videoId,
      { ...baseInput(VideoType.organic), spend: 10 },
      actor,
      {},
    ),
    /Fields are not allowed/,
  );
});

for (const [label, input, message] of [
  ['negative count', { views: -1 }, /non-negative integer/],
  ['decimal count', { views: 1.5 }, /non-negative integer/],
  ['negative percentage', { ctr: -0.1 }, /non-negative/],
  ['percentage above 100', { ctr: 100.1 }, /between 0 and 100/],
  ['negative ROI', { roi: -1 }, /non-negative/],
] as const) {
  test(`${label} is rejected`, async () => {
    await assert.rejects(
      createHarness({ videoType: VideoType.qianchuan_ad }).service.createSnapshot(
        videoId,
        { ...baseInput(VideoType.qianchuan_ad), ...input },
        actor,
        {},
      ),
      message,
    );
  });
}

test('zero is preserved and counts as a provided core metric', async () => {
  const result = await createHarness().service.createSnapshot(
    videoId,
    { dataStartDate: '2026-07-31', dataEndDate: '2026-08-01', views: 0 },
    actor,
    {},
  );
  assert.equal(result.views, 0);
});

test('dataStartDate after dataEndDate returns 400', async () => {
  await assert.rejects(
    createHarness().service.createSnapshot(videoId, {
      ...baseInput(),
      dataStartDate: '2026-08-03',
      dataEndDate: '2026-08-02',
    }, actor, {}),
    /dataStartDate/,
  );
});

test('publishDate after dataEndDate returns 400', async () => {
  await assert.rejects(
    createHarness().service.createSnapshot(videoId, {
      ...baseInput(),
      publishDate: '2026-08-03',
    }, actor, {}),
    /publishDate/,
  );
});

for (const url of ['javascript:alert(1)', 'data:text/plain,test', 'file:///tmp/test']) {
  test(`${url.split(':')[0]} URL is rejected`, async () => {
    await assert.rejects(
      createHarness().service.createSnapshot(videoId, {
        ...baseInput(),
        publishUrl: url,
      }, actor, {}),
      /http or https/,
    );
  });
}

test('text values are trimmed before persistence', async () => {
  const result = await createHarness().service.createSnapshot(videoId, {
    ...baseInput(),
    operatorNote: '  reviewed manually  ',
  }, actor, {});
  assert.equal(result.operatorNote, 'reviewed manually');
});

test('missing data period returns 400', async () => {
  await assert.rejects(
    createHarness().service.createSnapshot(videoId, { views: 1 }, actor, {}),
    /dataStartDate and dataEndDate/,
  );
});

test('missing a type-specific core metric returns 400', async () => {
  await assert.rejects(
    createHarness().service.createSnapshot(videoId, {
      dataStartDate: '2026-07-31',
      dataEndDate: '2026-08-01',
      impressions: 1,
    }, actor, {}),
    /core metric/,
  );
});

test('Decimal values preserve configured precision and serialize as strings', async () => {
  const result = await createHarness({ videoType: VideoType.qianchuan_ad }).service.createSnapshot(
    videoId,
    {
      ...baseInput(VideoType.qianchuan_ad),
      spend: 1234.56,
      cpc: 1.2345,
      roi: 2.8158,
    },
    actor,
    {},
  );
  assert.equal(result.spend, '1234.56');
  assert.equal(result.cpc, '1.2345');
  assert.equal(result.roi, '2.8158');
});

test('too many Decimal places are rejected', async () => {
  await assert.rejects(
    createHarness({ videoType: VideoType.qianchuan_ad }).service.createSnapshot(
      videoId,
      { ...baseInput(VideoType.qianchuan_ad), spend: 1.001 },
      actor,
      {},
    ),
    /at most 2 decimal places/,
  );
});

test('data consistency warnings do not rewrite submitted metrics', async () => {
  const result = await createHarness({ videoType: VideoType.qianchuan_ad }).service.createSnapshot(
    videoId,
    {
      ...baseInput(VideoType.qianchuan_ad),
      impressions: 100,
      clicks: 10,
      ctr: 99,
    },
    actor,
    {},
  );
  assert.equal(result.ctr, '99');
  assert.ok(result.dataWarnings.some((warning: string) => warning.includes('CTR')));
});
