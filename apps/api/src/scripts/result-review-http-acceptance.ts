import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaClient, UserRole, VideoStatus, VideoType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuthModule } from '../modules/auth/auth.module';
import { GptService } from '../modules/ai/gpt/gpt.service';
import { OperationLogsModule } from '../modules/operation-logs/operation-logs.module';
import { PermissionsModule } from '../modules/permissions/permissions.module';
import { PrismaModule } from '../modules/prisma/prisma.module';
import { ResultReviewsController } from '../modules/result-reviews/result-reviews.controller';
import {
  RESULT_REVIEW_BACKGROUND_SCHEDULER,
  ResultReviewBackgroundTask,
  ResultReviewsService,
} from '../modules/result-reviews/result-reviews.service';

const tasks: ResultReviewBackgroundTask[] = [];
const attempts = new Map<string, number>();
const sufficient = {
  dataSufficiency: 'sufficient' as const,
  sufficiencyReasons: [],
  dataScore: 82,
  dataGrade: 'A' as const,
  isBusinessEffectiveRecommendation: true,
  resultSummary: 'The supplied result snapshot supports continued testing.',
  performanceProblems: [],
  attributionAnalysis: [],
  optimizationSuggestions: [],
  continueTestRecommendation: 'continue' as const,
};
const insufficient = {
  dataSufficiency: 'insufficient' as const,
  sufficiencyReasons: [{
    code: 'sample_too_small' as const,
    description: 'The current sample is too small for a reliable score.',
    requiredNextData: ['Collect a longer observation period.'],
  }],
  dataScore: null,
  dataGrade: null,
  isBusinessEffectiveRecommendation: null,
  resultSummary: 'More structured data is required before scoring.',
  performanceProblems: [],
  attributionAnalysis: [{
    type: 'sample_size' as const,
    confidence: 100,
    evidence: ['The supplied observation period is limited.'],
    conclusion: 'Collect more data before drawing a performance conclusion.',
  }],
  optimizationSuggestions: [],
  continueTestRecommendation: 'collect_more_data' as const,
};

const fakeGptService = {
  reviewResultData: async ({ inputContext }: { inputContext: Record<string, any> }) => {
    const resultMetricId = inputContext.resultMetric.resultMetricId as string;
    const count = (attempts.get(resultMetricId) || 0) + 1;
    attempts.set(resultMetricId, count);
    if (inputContext.resultMetric.campaignName === 'fail-once' && count === 1) {
      throw new Error('Synthetic local OpenAI failure.');
    }
    const parsedOutput = inputContext.resultMetric.campaignName === 'insufficient'
      ? insufficient
      : sufficient;
    return {
      responseId: `fake-${randomUUID()}`,
      responseStatus: 'completed',
      model: 'gpt-5-mini',
      rawText: JSON.stringify(parsedOutput),
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      parsedOutput,
    };
  },
};

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    OperationLogsModule,
    PermissionsModule,
    AuthModule,
  ],
  controllers: [ResultReviewsController],
  providers: [
    ResultReviewsService,
    { provide: GptService, useValue: fakeGptService },
    { provide: RESULT_REVIEW_BACKGROUND_SCHEDULER, useValue: (task: ResultReviewBackgroundTask) => tasks.push(task) },
  ],
})
class ResultReviewHttpAcceptanceModule {}

type ScenarioKey = 'admin' | 'operator' | 'advertiser' | 'denied' | 'failure' | 'concurrent';
type Fixture = {
  userIds: string[];
  videoIds: string[];
  metricIds: string[];
  benchmarkIds: string[];
  accounts: Partial<Record<UserRole, string>>;
  videos: Record<ScenarioKey, { id: string; metricId: string }>;
};

async function createFixtures(prisma: PrismaClient): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const password = `Acceptance-${suffix}-Password!`;
  const passwordHash = await bcrypt.hash(password, 10);
  const roles = [UserRole.admin, UserRole.operator, UserRole.advertiser, UserRole.director];
  const users = await Promise.all(roles.map((role) => prisma.user.create({
    data: { name: `Acceptance ${role}`, account: `acceptance-${role}-${suffix}`, passwordHash, role },
  })));
  const byRole = Object.fromEntries(users.map((user) => [user.role, user]));

  const scenarios = [
    { key: 'admin', role: UserRole.admin, type: VideoType.product_card, isForAds: false, campaignName: 'sufficient' },
    { key: 'operator', role: UserRole.operator, type: VideoType.organic, isForAds: false, campaignName: 'sufficient' },
    { key: 'advertiser', role: UserRole.advertiser, type: VideoType.qianchuan_ad, isForAds: true, campaignName: 'insufficient' },
    { key: 'denied', role: UserRole.director, type: VideoType.organic, isForAds: false, campaignName: 'sufficient' },
    { key: 'failure', role: UserRole.admin, type: VideoType.qianchuan_ad, isForAds: true, campaignName: 'fail-once' },
    { key: 'concurrent', role: UserRole.admin, type: VideoType.product_card, isForAds: false, campaignName: 'sufficient' },
  ];
  const videos = {} as Record<ScenarioKey, { id: string; metricId: string }>;
  for (const scenario of scenarios) {
    const owner = byRole[UserRole.admin];
    const video = await prisma.video.create({
      data: {
        title: `HTTP acceptance ${scenario.key}`,
        originalFileName: `${scenario.key}.mp4`,
        filePath: `storage/videos/http-acceptance-${suffix}-${scenario.key}.mp4`,
        mimeType: 'video/mp4',
        fileSizeBytes: 1n,
        platform: 'acceptance-platform',
        brand: 'acceptance-brand',
        product: 'acceptance-product',
        videoType: scenario.type,
        isForAds: scenario.isForAds,
        creatorId: owner.id,
        status: VideoStatus.pending_result_data,
      },
    });
    const metric = await prisma.videoResultMetric.create({
      data: {
        videoId: video.id,
        videoType: scenario.type,
        submittedBy: byRole[scenario.role].id,
        dataStartDate: new Date('2026-07-01T00:00:00.000Z'),
        dataEndDate: new Date('2026-07-03T00:00:00.000Z'),
        campaignName: scenario.campaignName,
        impressions: 100,
        views: 100,
        clicks: 3,
        spend: '50.00',
        likes: 5,
      },
    });
    videos[scenario.key as ScenarioKey] = { id: video.id, metricId: metric.id };
  }
  const benchmark = await prisma.platformBenchmark.create({
    data: {
      platform: 'acceptance-platform', brand: 'acceptance-brand', videoType: VideoType.product_card,
      metricName: 'views', aThreshold: '80', direction: 'higher_is_better', enabled: true,
    },
  });
  const qianchuanBenchmark = await prisma.platformBenchmark.create({
    data: {
      platform: 'acceptance-platform', brand: 'acceptance-brand', videoType: VideoType.qianchuan_ad,
      metricName: 'impressions', aThreshold: '80', direction: 'higher_is_better', enabled: true,
    },
  });
  const organicBenchmark = await prisma.platformBenchmark.create({
    data: {
      platform: 'acceptance-platform', brand: 'acceptance-brand', videoType: VideoType.organic,
      metricName: 'views', aThreshold: '80', direction: 'higher_is_better', enabled: true,
    },
  });
  return {
    userIds: users.map((user) => user.id),
    videoIds: Object.values(videos).map((video) => video.id),
    metricIds: Object.values(videos).map((video) => video.metricId),
    benchmarkIds: [benchmark.id, qianchuanBenchmark.id, organicBenchmark.id],
    accounts: Object.fromEntries(roles.map((role) => [role, `${byRole[role].account}:${password}`])),
    videos,
  };
}

async function cleanup(prisma: PrismaClient, fixture: Fixture) {
  await prisma.operationLog.deleteMany({ where: { OR: [{ userId: { in: fixture.userIds } }, { videoId: { in: fixture.videoIds } }] } });
  await prisma.aiResultReview.deleteMany({ where: { videoId: { in: fixture.videoIds } } });
  await prisma.videoResultMetric.deleteMany({ where: { id: { in: fixture.metricIds } } });
  await prisma.video.deleteMany({ where: { id: { in: fixture.videoIds } } });
  await prisma.user.deleteMany({ where: { id: { in: fixture.userIds } } });
  await prisma.platformBenchmark.deleteMany({ where: { id: { in: fixture.benchmarkIds } } });
}

async function main() {
  const prisma = new PrismaClient();
  let fixture: Fixture | undefined;
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
  try {
    fixture = await createFixtures(prisma);
    app = await NestFactory.create(ResultReviewHttpAcceptanceModule, {
      logger: ['error'],
      abortOnError: false,
    });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;

    async function login(role: UserRole) {
      const [account, password] = fixture!.accounts[role]!.split(':');
      const response = await fetch(`${base}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account, password }),
      });
      assert.equal(response.status, 201);
      return (await response.json() as { accessToken: string }).accessToken;
    }
    const tokens = Object.fromEntries(await Promise.all(
      [UserRole.admin, UserRole.operator, UserRole.advertiser, UserRole.director].map(async (role) => [role, await login(role)]),
    )) as Partial<Record<UserRole, string>>;
    const request = (path: string, token: string, init: RequestInit = {}) => fetch(`${base}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
    });
    const trigger = (scenario: ScenarioKey, role: UserRole) => {
      const target = fixture!.videos[scenario];
      return request(`/api/videos/${target.id}/result-review`, tokens[role]!, {
        method: 'POST', body: JSON.stringify({ resultMetricId: target.metricId }),
      });
    };
    const runTask = async () => { const task = tasks.shift(); assert.ok(task); await task(); };

    for (const [scenario, role] of [
      ['admin', UserRole.admin], ['operator', UserRole.operator], ['advertiser', UserRole.advertiser],
    ] as const) {
      const response = await trigger(scenario, role);
      assert.equal(response.status, 202);
      assert.equal((await response.json() as { status: string }).status, 'running');
      await runTask();
    }
    const adminReview = await prisma.aiResultReview.findFirst({ where: { videoId: fixture.videos.admin.id }, orderBy: { createdAt: 'desc' } });
    const advertiserReview = await prisma.aiResultReview.findFirst({ where: { videoId: fixture.videos.advertiser.id }, orderBy: { createdAt: 'desc' } });
    assert.equal(adminReview?.status, 'succeeded');
    assert.equal(adminReview?.dataGrade, 'A');
    assert.equal((await prisma.video.findUnique({ where: { id: fixture.videos.admin.id } }))?.status, 'pending_rule_engine');
    assert.equal(advertiserReview?.dataSufficiency, 'insufficient');
    assert.equal(advertiserReview?.dataScore, null);
    assert.equal(advertiserReview?.dataGrade, null);

    const denied = await trigger('denied', UserRole.director);
    assert.equal(denied.status, 403);
    assert.equal(await prisma.aiResultReview.count({ where: { videoId: fixture.videos.denied.id } }), 0);

    const failure = await trigger('failure', UserRole.admin);
    assert.equal(failure.status, 202);
    await runTask();
    assert.equal((await prisma.video.findUnique({ where: { id: fixture.videos.failure.id } }))?.status, 'ai_result_failed');
    const retry = await trigger('failure', UserRole.admin);
    assert.equal(retry.status, 202);
    await runTask();
    assert.equal(await prisma.aiResultReview.count({ where: { videoId: fixture.videos.failure.id } }), 2);
    assert.equal((await prisma.aiResultReview.findFirst({ where: { videoId: fixture.videos.failure.id }, orderBy: { createdAt: 'desc' } }))?.status, 'succeeded');

    const concurrent = await Promise.all([trigger('concurrent', UserRole.admin), trigger('concurrent', UserRole.admin)]);
    assert.deepEqual(concurrent.map((response) => response.status).sort(), [202, 409]);
    await runTask();
    const repeated = await trigger('concurrent', UserRole.admin);
    assert.equal(repeated.status, 409);

    const latest = await request(`/api/videos/${fixture.videos.admin.id}/result-review/latest`, tokens.admin!);
    assert.equal(latest.status, 200);
    const latestBody = await latest.json() as Record<string, any>;
    assert.equal(latestBody.review.status, 'succeeded');
    assert.equal('rawResponse' in latestBody.review, false);
    const history = await request(`/api/videos/${fixture.videos.failure.id}/result-reviews/history?limit=20`, tokens.admin!);
    assert.equal(history.status, 200);
    assert.equal((await history.json() as { items: unknown[] }).items.length, 2);

    assert.ok(await prisma.operationLog.count({
      where: { videoId: { in: fixture.videoIds }, actionType: { startsWith: 'ai_result_review_' } },
    }) >= 8);
    assert.equal(await prisma.ruleEngineResult.count({ where: { videoId: { in: fixture.videoIds } } }), 0);
    assert.equal(await prisma.finalVideoEvaluation.count({ where: { videoId: { in: fixture.videoIds } } }), 0);
    process.stdout.write('Result review HTTP acceptance passed.\n');
  } finally {
    tasks.splice(0);
    if (app) await app.close();
    if (fixture) await cleanup(prisma, fixture);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  process.stderr.write(`Result review HTTP acceptance failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
