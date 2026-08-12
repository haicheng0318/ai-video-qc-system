import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AiReviewStatus, DataSufficiency, PrismaClient, UserRole, VideoStatus, VideoType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuthModule } from '../modules/auth/auth.module';
import { CasesModule } from '../modules/cases/cases.module';
import { DashboardModule } from '../modules/dashboard/dashboard.module';
import { FinalConfirmationsModule } from '../modules/final-confirmations/final-confirmations.module';
import { OperationLogsModule } from '../modules/operation-logs/operation-logs.module';
import { PermissionsModule } from '../modules/permissions/permissions.module';
import { PrismaModule } from '../modules/prisma/prisma.module';
import { evaluateRuleBoundary } from '../modules/rule-engine/rule-engine.rules';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 200 }]), PrismaModule, OperationLogsModule,
    PermissionsModule, AuthModule, FinalConfirmationsModule, CasesModule, DashboardModule,
  ],
})
class AcceptanceModule {}

type Fixture = {
  users: Record<string, { id: string; account: string }>;
  password: string;
  videoIds: string[];
  evaluations: Record<string, string>;
  userIds: string[];
};

async function createTarget(prisma: PrismaClient, creatorId: string, reviewerId: string, key: string, contentGrade: string, dataGrade: string, recommendation: string) {
  const video = await prisma.video.create({ data: {
    title: `Phase 8 ${key}`, originalFileName: `${key}.mp4`, filePath: `storage/videos/phase8-${key}.mp4`,
    mimeType: 'video/mp4', fileSizeBytes: 1n, videoType: VideoType.organic, brand: 'Phase 8 Brand', platform: 'douyin',
    creatorId, status: VideoStatus.pending_final_confirmation,
  } });
  const content = await prisma.aiContentReview.create({ data: {
    videoId: video.id, modelProvider: 'gemini', modelName: 'fixture', status: AiReviewStatus.succeeded,
    contentGrade, totalScore: 80,
  } });
  await prisma.supervisorReview.create({ data: {
    videoId: video.id, reviewerId, decision: VideoStatus.approved_for_publish, isAllowedToPublish: true,
  } });
  const metric = await prisma.videoResultMetric.create({ data: {
    videoId: video.id, videoType: VideoType.organic, submittedBy: creatorId,
    dataStartDate: new Date('2026-08-01'), dataEndDate: new Date('2026-08-02'), views: 100,
  } });
  const result = await prisma.aiResultReview.create({ data: {
    videoId: video.id, resultMetricId: metric.id, modelProvider: 'openai', modelName: 'fixture',
    status: AiReviewStatus.succeeded, dataSufficiency: DataSufficiency.sufficient, dataGrade, dataScore: 80,
  } });
  const boundary = evaluateRuleBoundary({ contentGrade, dataGrade, dataSufficiency: 'sufficient' });
  const rule = await prisma.ruleEngineResult.create({ data: {
    videoId: video.id, contentReviewId: content.id, resultReviewId: result.id, ...boundary,
  } });
  const statusByGrade: Record<string, string> = { effective: 'final_effective', low_effective: 'final_low_effective', invalid: 'final_invalid' };
  const evaluation = await prisma.finalVideoEvaluation.create({ data: {
    videoId: video.id, contentReviewId: content.id, resultReviewId: result.id, ruleEngineResultId: rule.id,
    status: AiReviewStatus.succeeded, triggeredById: reviewerId, modelProvider: 'openai', modelName: 'fixture',
    contentGrade, dataGrade, recommendedFinalGrade: recommendation,
    recommendedFinalStatus: statusByGrade[recommendation], recommendedIsEffective: recommendation !== 'invalid',
    recommendationConfidence: 80, completedAt: new Date(), successKey: `${rule.id}:final-evaluation-v1`,
  } });
  return { videoId: video.id, evaluationId: evaluation.id };
}

async function createFixture(prisma: PrismaClient): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const password = `Phase8-${suffix}-Password!`;
  const passwordHash = await bcrypt.hash(password, 10);
  const created = await Promise.all(Object.values(UserRole).map((role) => prisma.user.create({
    data: { name: `Phase8 ${role}`, account: `phase8-${role}-${suffix}`, passwordHash, role },
  })));
  const users = Object.fromEntries(created.map((item) => [item.role, { id: item.id, account: item.account }]));
  const targets = {
    effective: await createTarget(prisma, users.admin.id, users.content_owner.id, 'effective', 'A', 'A', 'effective'),
    low: await createTarget(prisma, users.admin.id, users.content_owner.id, 'low', 'A', 'C', 'low_effective'),
    invalid: await createTarget(prisma, users.admin.id, users.content_owner.id, 'invalid', 'C', 'C', 'invalid'),
    manual: await createTarget(prisma, users.admin.id, users.content_owner.id, 'manual', 'C', 'A', 'effective'),
    denied: await createTarget(prisma, users.admin.id, users.content_owner.id, 'denied', 'A', 'A', 'effective'),
    duplicate: await createTarget(prisma, users.admin.id, users.content_owner.id, 'duplicate', 'A', 'A', 'effective'),
  };
  return {
    users, password, videoIds: Object.values(targets).map((target) => target.videoId),
    evaluations: Object.fromEntries(Object.entries(targets).map(([key, target]) => [key, target.evaluationId])),
    userIds: created.map((item) => item.id),
  };
}

async function cleanup(prisma: PrismaClient, fixture: Fixture) {
  await prisma.operationLog.deleteMany({ where: { videoId: { in: fixture.videoIds } } });
  await prisma.finalVideoEvaluation.deleteMany({ where: { videoId: { in: fixture.videoIds } } });
  await prisma.ruleEngineResult.deleteMany({ where: { videoId: { in: fixture.videoIds } } });
  await prisma.aiResultReview.deleteMany({ where: { videoId: { in: fixture.videoIds } } });
  await prisma.videoResultMetric.deleteMany({ where: { videoId: { in: fixture.videoIds } } });
  await prisma.supervisorReview.deleteMany({ where: { videoId: { in: fixture.videoIds } } });
  await prisma.aiContentReview.deleteMany({ where: { videoId: { in: fixture.videoIds } } });
  await prisma.video.deleteMany({ where: { id: { in: fixture.videoIds } } });
  await prisma.user.deleteMany({ where: { id: { in: fixture.userIds } } });
}

async function main() {
  const prisma = new PrismaClient();
  let fixture: Fixture | undefined;
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
  try {
    fixture = await createFixture(prisma);
    app = await NestFactory.create(AcceptanceModule, { logger: ['error'], abortOnError: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    const tokens: Record<string, string> = {};
    for (const role of Object.values(UserRole)) {
      const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ account: fixture.users[role].account, password: fixture.password }) });
      assert.equal(response.status, 201); tokens[role] = (await response.json() as any).accessToken;
    }
    const request = (path: string, role: UserRole, init: RequestInit = {}) => fetch(`${base}${path}`, {
      ...init, headers: { authorization: `Bearer ${tokens[role]}`, 'content-type': 'application/json', ...init.headers },
    });
    const confirm = (key: string, finalGrade: string, role: UserRole = UserRole.admin, extra: Record<string, unknown> = {}) => {
      const videoId = fixture!.videoIds[Object.keys(fixture!.evaluations).indexOf(key)];
      return request(`/api/videos/${videoId}/final-confirmation`, role, { method: 'POST', body: JSON.stringify({
        evaluationId: fixture!.evaluations[key], finalGrade, canBeUsedForPerformance: finalGrade === 'effective', ...extra,
      }) });
    };

    assert.equal((await confirm('effective', 'effective')).status, 200);
    assert.equal((await confirm('low', 'low_effective', UserRole.content_owner)).status, 200);
    assert.equal((await confirm('invalid', 'invalid')).status, 200);
    assert.equal((await confirm('manual', 'low_effective', UserRole.content_owner, {
      canBeUsedForPerformance: false, confirmationComment: '人工复核确认业务证据完整', manualAdjustReason: '结合线下业务证据调整建议等级',
    })).status, 200);
    for (const role of [UserRole.supervisor, UserRole.director, UserRole.operator, UserRole.advertiser]) {
      assert.equal((await confirm('denied', 'effective', role)).status, 403);
    }
    const concurrent = await Promise.all([confirm('duplicate', 'effective'), confirm('duplicate', 'effective')]);
    assert.deepEqual(concurrent.map((item) => item.status).sort(), [200, 409]);

    const effectiveId = fixture.videoIds[0]; const invalidId = fixture.videoIds[2];
    assert.equal((await request(`/api/videos/${effectiveId}/case-marking`, UserRole.admin, { method: 'PUT', body: JSON.stringify({ evaluationId: fixture.evaluations.effective, caseType: 'excellent', reason: '内容和数据表现均可复用' }) })).status, 200);
    assert.equal((await request(`/api/videos/${invalidId}/case-marking`, UserRole.content_owner, { method: 'PUT', body: JSON.stringify({ evaluationId: fixture.evaluations.invalid, caseType: 'negative', reason: '内容与数据结果均不达标' }) })).status, 200);
    assert.equal((await request('/api/cases?type=excellent', UserRole.admin)).status, 200);
    assert.equal((await request('/api/cases?type=negative', UserRole.admin)).status, 200);
    const summary = await request('/api/dashboard/summary?startDate=2026-08-01&endDate=2026-08-31', UserRole.admin);
    assert.equal(summary.status, 200); assert.ok((await summary.json() as any).finalizedCount >= 5);
    assert.equal((await request('/api/dashboard/trend?granularity=day&startDate=2026-08-01&endDate=2026-08-31', UserRole.admin)).status, 200);
    assert.equal((await request('/api/dashboard/breakdown?groupBy=brand&startDate=2026-08-01&endDate=2026-08-31', UserRole.admin)).status, 200);

    assert.equal((await prisma.video.findUnique({ where: { id: effectiveId } }))?.status, VideoStatus.final_effective);
    assert.equal((await prisma.video.findUnique({ where: { id: invalidId } }))?.status, VideoStatus.final_invalid);
    assert.equal(await prisma.operationLog.count({ where: { videoId: { in: fixture.videoIds }, actionType: 'final_evaluation_confirmed' } }), 5);
    assert.equal(await prisma.operationLog.count({ where: { videoId: fixture.videoIds[3], actionType: 'final_grade_adjusted' } }), 1);
    assert.equal(await prisma.operationLog.count({ where: { videoId: effectiveId, actionType: 'excellent_case_marked' } }), 1);
    assert.equal(await prisma.operationLog.count({ where: { videoId: invalidId, actionType: 'negative_case_marked' } }), 1);
    process.stdout.write('Phase 8 HTTP acceptance passed. Formal confirmation, case libraries and dashboard use persisted human-confirmed data.\n');
  } finally {
    if (app) await app.close();
    if (fixture) await cleanup(prisma, fixture);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  process.stderr.write(`Phase 8 HTTP acceptance failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
