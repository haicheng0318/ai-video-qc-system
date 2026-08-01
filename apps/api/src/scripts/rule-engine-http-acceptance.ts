import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  AiReviewStatus,
  DataSufficiency,
  PrismaClient,
  UserRole,
  VideoStatus,
  VideoType,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuthModule } from '../modules/auth/auth.module';
import { OperationLogsModule } from '../modules/operation-logs/operation-logs.module';
import { PermissionsModule } from '../modules/permissions/permissions.module';
import { PrismaModule } from '../modules/prisma/prisma.module';
import { RuleEngineModule } from '../modules/rule-engine/rule-engine.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    OperationLogsModule,
    PermissionsModule,
    AuthModule,
    RuleEngineModule,
  ],
})
class RuleEngineHttpAcceptanceModule {}

type Scenario = {
  key: string;
  contentGrade: string;
  dataGrade: string | null;
  dataSufficiency: DataSufficiency;
  expectedCode: string;
  expectedStatus: VideoStatus;
};

const scenarios: Scenario[] = [
  { key: 'r00', contentGrade: 'A', dataGrade: null, dataSufficiency: DataSufficiency.insufficient, expectedCode: 'R00_DATA_INSUFFICIENT', expectedStatus: VideoStatus.pending_data },
  { key: 'r11', contentGrade: 'S', dataGrade: 'A', dataSufficiency: DataSufficiency.sufficient, expectedCode: 'R11_CONTENT_HIGH_DATA_HIGH', expectedStatus: VideoStatus.pending_final_evaluation },
  { key: 'r12', contentGrade: 'A', dataGrade: 'B', dataSufficiency: DataSufficiency.sufficient, expectedCode: 'R12_CONTENT_HIGH_DATA_MID', expectedStatus: VideoStatus.pending_final_evaluation },
  { key: 'r13', contentGrade: 'A', dataGrade: 'D', dataSufficiency: DataSufficiency.sufficient, expectedCode: 'R13_CONTENT_HIGH_DATA_LOW', expectedStatus: VideoStatus.pending_final_evaluation },
  { key: 'r21', contentGrade: 'B', dataGrade: 'S', dataSufficiency: DataSufficiency.sufficient, expectedCode: 'R21_CONTENT_MID_DATA_HIGH', expectedStatus: VideoStatus.pending_final_evaluation },
  { key: 'r22', contentGrade: 'B', dataGrade: 'B', dataSufficiency: DataSufficiency.sufficient, expectedCode: 'R22_CONTENT_MID_DATA_MID', expectedStatus: VideoStatus.pending_final_evaluation },
  { key: 'r23', contentGrade: 'B', dataGrade: 'C', dataSufficiency: DataSufficiency.sufficient, expectedCode: 'R23_CONTENT_MID_DATA_LOW', expectedStatus: VideoStatus.pending_final_evaluation },
  { key: 'r31', contentGrade: 'C', dataGrade: 'S', dataSufficiency: DataSufficiency.sufficient, expectedCode: 'R31_CONTENT_LOW_DATA_HIGH', expectedStatus: VideoStatus.pending_final_evaluation },
  { key: 'r32', contentGrade: 'D', dataGrade: 'B', dataSufficiency: DataSufficiency.sufficient, expectedCode: 'R32_CONTENT_LOW_DATA_MID', expectedStatus: VideoStatus.pending_final_evaluation },
  { key: 'r33', contentGrade: 'D', dataGrade: 'C', dataSufficiency: DataSufficiency.sufficient, expectedCode: 'R33_CONTENT_LOW_DATA_LOW', expectedStatus: VideoStatus.pending_final_evaluation },
];

type Target = { videoId: string; resultReviewId: string; contentReviewId: string; metricId: string };
type Fixture = {
  password: string;
  users: Partial<Record<UserRole, { id: string; account: string }>>;
  userIds: string[];
  videoIds: string[];
  metricIds: string[];
  contentReviewIds: string[];
  resultReviewIds: string[];
  supervisorReviewIds: string[];
  targets: Record<string, Target>;
};

async function createTarget(
  prisma: PrismaClient,
  ownerId: string,
  reviewerId: string,
  suffix: string,
  scenario: Scenario,
): Promise<Target> {
  const video = await prisma.video.create({
    data: {
      title: `Rule HTTP ${scenario.key}`,
      originalFileName: `${scenario.key}.mp4`,
      filePath: `storage/videos/rule-http-${suffix}-${scenario.key}.mp4`,
      mimeType: 'video/mp4',
      fileSizeBytes: 1n,
      videoType: VideoType.organic,
      creatorId: ownerId,
      status: VideoStatus.pending_rule_engine,
    },
  });
  const contentReview = await prisma.aiContentReview.create({
    data: {
      videoId: video.id,
      modelProvider: 'gemini', modelName: 'acceptance-fixture',
      status: AiReviewStatus.succeeded, contentGrade: scenario.contentGrade,
      createdAt: new Date('2026-08-01T10:00:00.000Z'),
    },
  });
  const supervisorReview = await prisma.supervisorReview.create({
    data: {
      videoId: video.id, reviewerId, decision: VideoStatus.approved_for_publish,
      isAllowedToPublish: true, reviewedAt: new Date('2026-08-01T11:00:00.000Z'),
    },
  });
  const metric = await prisma.videoResultMetric.create({
    data: {
      videoId: video.id, videoType: VideoType.organic, submittedBy: ownerId,
      dataStartDate: new Date('2026-07-01T00:00:00.000Z'),
      dataEndDate: new Date('2026-07-03T00:00:00.000Z'), views: 100,
    },
  });
  const resultReview = await prisma.aiResultReview.create({
    data: {
      videoId: video.id, resultMetricId: metric.id,
      modelProvider: 'openai', modelName: 'acceptance-fixture',
      status: AiReviewStatus.succeeded,
      dataSufficiency: scenario.dataSufficiency,
      dataGrade: scenario.dataGrade,
      dataScore: scenario.dataSufficiency === DataSufficiency.sufficient ? 75 : null,
    },
  });
  return {
    videoId: video.id,
    resultReviewId: resultReview.id,
    contentReviewId: contentReview.id,
    metricId: metric.id,
    supervisorReviewId: supervisorReview.id,
  } as Target & { supervisorReviewId: string };
}

async function createFixtures(prisma: PrismaClient): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const password = `Rule-${suffix}-Password!`;
  const passwordHash = await bcrypt.hash(password, 10);
  const roles = Object.values(UserRole);
  const createdUsers = await Promise.all(roles.map((role) => prisma.user.create({
    data: { name: `Rule ${role}`, account: `rule-${role}-${suffix}`, passwordHash, role },
  })));
  const users = Object.fromEntries(createdUsers.map((user) => [user.role, { id: user.id, account: user.account }]));
  const owner = users[UserRole.admin]!;
  const reviewer = users[UserRole.content_owner]!;
  const allScenarios = [
    ...scenarios,
    { ...scenarios[1], key: 'content-owner' },
    { ...scenarios[1], key: 'denied' },
    { ...scenarios[1], key: 'concurrent' },
  ];
  const targets: Record<string, Target> = {};
  const supervisorReviewIds: string[] = [];
  for (const scenario of allScenarios) {
    const target = await createTarget(prisma, owner.id, reviewer.id, suffix, scenario) as Target & { supervisorReviewId: string };
    targets[scenario.key] = target;
    supervisorReviewIds.push(target.supervisorReviewId);
  }
  return {
    password, users,
    userIds: createdUsers.map((user) => user.id),
    videoIds: Object.values(targets).map((target) => target.videoId),
    metricIds: Object.values(targets).map((target) => target.metricId),
    contentReviewIds: Object.values(targets).map((target) => target.contentReviewId),
    resultReviewIds: Object.values(targets).map((target) => target.resultReviewId),
    supervisorReviewIds,
    targets,
  };
}

async function cleanup(prisma: PrismaClient, fixture: Fixture) {
  await prisma.operationLog.deleteMany({ where: { videoId: { in: fixture.videoIds } } });
  await prisma.finalVideoEvaluation.deleteMany({ where: { videoId: { in: fixture.videoIds } } });
  await prisma.ruleEngineResult.deleteMany({ where: { videoId: { in: fixture.videoIds } } });
  await prisma.aiResultReview.deleteMany({ where: { id: { in: fixture.resultReviewIds } } });
  await prisma.videoResultMetric.deleteMany({ where: { id: { in: fixture.metricIds } } });
  await prisma.supervisorReview.deleteMany({ where: { id: { in: fixture.supervisorReviewIds } } });
  await prisma.aiContentReview.deleteMany({ where: { id: { in: fixture.contentReviewIds } } });
  await prisma.video.deleteMany({ where: { id: { in: fixture.videoIds } } });
  await prisma.user.deleteMany({ where: { id: { in: fixture.userIds } } });
}

async function main() {
  const prisma = new PrismaClient();
  let fixture: Fixture | undefined;
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
  try {
    fixture = await createFixtures(prisma);
    app = await NestFactory.create(RuleEngineHttpAcceptanceModule, { logger: ['error'], abortOnError: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    const tokens = {} as Partial<Record<UserRole, string>>;
    for (const role of Object.values(UserRole)) {
      const response = await fetch(`${base}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account: fixture.users[role]!.account, password: fixture.password }),
      });
      assert.equal(response.status, 201);
      tokens[role] = (await response.json() as { accessToken: string }).accessToken;
    }
    const request = (path: string, role: UserRole, init: RequestInit = {}) => fetch(`${base}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${tokens[role]}`, 'content-type': 'application/json', ...init.headers },
    });
    const execute = (key: string, role: UserRole) => {
      const target = fixture!.targets[key];
      return request(`/api/videos/${target.videoId}/rule-engine`, role, {
        method: 'POST', body: JSON.stringify({ resultReviewId: target.resultReviewId }),
      });
    };

    for (const scenario of scenarios) {
      const response = await execute(scenario.key, UserRole.admin);
      assert.equal(response.status, 201);
      const body = await response.json() as Record<string, any>;
      assert.equal(body.ruleEngineResult.ruleCode, scenario.expectedCode);
      assert.equal(body.videoStatus, scenario.expectedStatus);
      assert.equal(body.ruleEngineResult.resultReviewId, fixture.targets[scenario.key].resultReviewId);
      assert.equal(body.ruleEngineResult.contentReviewId, fixture.targets[scenario.key].contentReviewId);
    }

    assert.equal((await execute('content-owner', UserRole.content_owner)).status, 201);
    for (const role of [UserRole.operator, UserRole.advertiser, UserRole.supervisor, UserRole.director]) {
      assert.equal((await execute('denied', role)).status, 403);
    }
    assert.equal(await prisma.ruleEngineResult.count({ where: { videoId: fixture.targets.denied.videoId } }), 0);

    const concurrent = await Promise.all([
      execute('concurrent', UserRole.admin), execute('concurrent', UserRole.admin),
    ]);
    assert.deepEqual(concurrent.map((response) => response.status).sort(), [201, 409]);
    assert.equal(await prisma.ruleEngineResult.count({ where: { videoId: fixture.targets.concurrent.videoId } }), 1);
    assert.equal(await prisma.operationLog.count({
      where: { videoId: fixture.targets.concurrent.videoId, actionType: 'rule_engine_executed' },
    }), 1);
    assert.equal((await execute('concurrent', UserRole.admin)).status, 409);

    const latest = await request(`/api/videos/${fixture.targets.r12.videoId}/rule-engine/latest`, UserRole.admin);
    assert.equal(latest.status, 200);
    const latestBody = await latest.json() as Record<string, any>;
    assert.equal(latestBody.ruleEngineResult.ruleCode, 'R12_CONTENT_HIGH_DATA_MID');
    assert.equal('rawResponse' in latestBody.ruleEngineResult, false);
    const history = await request(`/api/videos/${fixture.targets.r12.videoId}/rule-engine/history?limit=20`, UserRole.admin);
    assert.equal(history.status, 200);
    const historyBody = await history.json() as { items: Array<Record<string, any>> };
    assert.equal(historyBody.items.length, 1);
    assert.equal(historyBody.items[0].isLatest, true);

    assert.equal(await prisma.ruleEngineResult.count({ where: { videoId: { in: fixture.videoIds } } }), 12);
    assert.equal(await prisma.operationLog.count({
      where: { videoId: { in: fixture.videoIds }, actionType: 'rule_engine_executed' },
    }), 12);
    assert.equal(await prisma.finalVideoEvaluation.count({ where: { videoId: { in: fixture.videoIds } } }), 0);
    assert.equal(await prisma.video.count({ where: { id: { in: fixture.videoIds }, status: VideoStatus.pending_final_confirmation } }), 0);
    process.stdout.write('Rule engine HTTP acceptance passed. No AI was called and no final evaluation was created.\n');
  } finally {
    if (app) await app.close();
    if (fixture) await cleanup(prisma, fixture);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  process.stderr.write(`Rule engine HTTP acceptance failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
