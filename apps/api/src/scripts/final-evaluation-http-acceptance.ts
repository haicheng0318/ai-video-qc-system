import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  AiReviewStatus, DataSufficiency, PrismaClient, UserRole, VideoStatus, VideoType,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuthModule } from '../modules/auth/auth.module';
import { GptService } from '../modules/ai/gpt/gpt.service';
import { validateFinalEvaluationOutput } from '../modules/ai/gpt/gpt-final-evaluation.schema';
import { FinalEvaluationsController } from '../modules/final-evaluations/final-evaluations.controller';
import {
  FINAL_EVALUATION_BACKGROUND_SCHEDULER,
  FinalEvaluationBackgroundTask,
  FinalEvaluationsService,
} from '../modules/final-evaluations/final-evaluations.service';
import { OperationLogsModule } from '../modules/operation-logs/operation-logs.module';
import { PermissionsModule } from '../modules/permissions/permissions.module';
import { PrismaModule } from '../modules/prisma/prisma.module';
import { evaluateRuleBoundary } from '../modules/rule-engine/rule-engine.rules';

const tasks: FinalEvaluationBackgroundTask[] = [];
const attempts = new Map<string, number>();

function suggestion(grade: 'effective' | 'low_effective' | 'invalid', manual = false) {
  const map = {
    effective: ['final_effective', true], low_effective: ['final_low_effective', true], invalid: ['final_invalid', false],
  } as const;
  return {
    recommendedFinalGrade: grade, recommendedFinalStatus: map[grade][0], recommendedIsEffective: map[grade][1],
    recommendationConfidence: 80,
    decisionSummary: manual ? '内容判断与数据表现存在偏差，需要负责人确认。' : '证据支持该建议，等待负责人确认。',
    evidenceAssessment: [
      { source: 'content_review' as const, strength: 'high' as const, evidence: ['内容证据'], conclusion: '内容证据可用' },
      { source: 'result_review' as const, strength: 'high' as const, evidence: ['数据证据'], conclusion: '数据证据可用' },
      { source: 'rule_engine' as const, strength: 'high' as const, evidence: ['规则证据'], conclusion: '规则边界明确' },
    ],
    finalAttribution: [{ type: 'mixed' as const, confidence: 70, evidence: ['综合证据'], conclusion: '综合因素' }],
    finalSuggestion: '建议负责人复核后确认。', confirmationFocus: ['复核业务背景'],
    riskFlags: manual ? [{ code: 'content_data_conflict' as const, description: '内容与数据存在冲突。' }] : [],
  };
}

const fakeGpt = {
  generateFinalEvaluation: async ({ inputContext, recommendedBoundary }: any) => {
    const context = inputContext as any;
    const id = context.ruleEngine.ruleEngineResultId as string;
    const count = (attempts.get(id) || 0) + 1;
    attempts.set(id, count);
    if (context.video.brand === 'fail-once' && count === 1) throw new Error('Synthetic OpenAI failure.');
    let grade: 'effective' | 'low_effective' | 'invalid' = 'effective';
    if (recommendedBoundary === 'allow_final_effective_or_low_effective') grade = 'low_effective';
    if (recommendedBoundary === 'allow_final_low_effective_or_invalid') grade = 'low_effective';
    if (recommendedBoundary === 'require_final_invalid') grade = 'invalid';
    if (context.video.brand === 'violate-boundary') grade = 'invalid';
    const parsedOutput = validateFinalEvaluationOutput(
      suggestion(grade, recommendedBoundary === 'require_manual_confirmation'), recommendedBoundary,
    );
    return {
      responseId: `fake-${randomUUID()}`, responseStatus: 'completed', model: 'gpt-5-mini',
      rawText: JSON.stringify(parsedOutput), usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, parsedOutput,
    };
  },
};

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 200 }]), PrismaModule, OperationLogsModule, PermissionsModule, AuthModule],
  controllers: [FinalEvaluationsController],
  providers: [
    FinalEvaluationsService,
    { provide: GptService, useValue: fakeGpt },
    { provide: FINAL_EVALUATION_BACKGROUND_SCHEDULER, useValue: (task: FinalEvaluationBackgroundTask) => tasks.push(task) },
  ],
})
class AcceptanceModule {}

type Target = { videoId: string; contentId: string; metricId: string; resultId: string; ruleId: string; supervisorId: string };
type Fixture = { users: Record<string, { id: string; account: string }>; password: string; targets: Record<string, Target>; userIds: string[] };

const scenarios = [
  ['effective', 'A', 'A', 'normal'],
  ['low-effective', 'B', 'A', 'normal'],
  ['low-or-invalid', 'A', 'C', 'normal'],
  ['manual', 'C', 'A', 'normal'],
  ['invalid', 'C', 'C', 'normal'],
  ['content-owner', 'A', 'A', 'normal'],
  ['denied', 'A', 'A', 'normal'],
  ['concurrent', 'A', 'A', 'normal'],
  ['failure', 'A', 'A', 'fail-once'],
  ['violation', 'A', 'A', 'violate-boundary'],
  ['stale', 'A', 'A', 'normal'],
] as const;

async function createTarget(prisma: PrismaClient, ownerId: string, reviewerId: string, key: string, contentGrade: string, dataGrade: string, brand: string) {
  const video = await prisma.video.create({ data: {
    title: `Final HTTP ${key}`, originalFileName: `${key}.mp4`, filePath: `storage/videos/final-${key}.mp4`,
    mimeType: 'video/mp4', fileSizeBytes: 1n, videoType: VideoType.organic, brand,
    creatorId: ownerId, status: VideoStatus.pending_final_evaluation,
  } });
  const content = await prisma.aiContentReview.create({ data: {
    videoId: video.id, modelProvider: 'gemini', modelName: 'fixture', status: AiReviewStatus.succeeded,
    contentGrade, totalScore: 80,
  } });
  const supervisor = await prisma.supervisorReview.create({ data: {
    videoId: video.id, reviewerId, decision: VideoStatus.approved_for_publish, isAllowedToPublish: true,
  } });
  const metric = await prisma.videoResultMetric.create({ data: {
    videoId: video.id, videoType: VideoType.organic, submittedBy: ownerId,
    dataStartDate: new Date('2026-08-01'), dataEndDate: new Date('2026-08-02'), views: 0, ctr: '2.3500',
  } });
  const resultReview = await prisma.aiResultReview.create({ data: {
    videoId: video.id, resultMetricId: metric.id, modelProvider: 'openai', modelName: 'fixture',
    status: AiReviewStatus.succeeded, dataSufficiency: DataSufficiency.sufficient, dataGrade, dataScore: 80,
  } });
  const boundary = evaluateRuleBoundary({ contentGrade, dataGrade, dataSufficiency: 'sufficient' });
  const rule = await prisma.ruleEngineResult.create({ data: {
    videoId: video.id, contentReviewId: content.id, resultReviewId: resultReview.id, ruleVersion: 'rule-engine-v1', ...boundary,
  } });
  return { videoId: video.id, contentId: content.id, metricId: metric.id, resultId: resultReview.id, ruleId: rule.id, supervisorId: supervisor.id };
}

async function createFixture(prisma: PrismaClient): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const password = `Final-${suffix}-Password!`;
  const passwordHash = await bcrypt.hash(password, 10);
  const created = await Promise.all(Object.values(UserRole).map((role) => prisma.user.create({
    data: { name: `Final ${role}`, account: `final-${role}-${suffix}`, passwordHash, role },
  })));
  const users = Object.fromEntries(created.map((item) => [item.role, { id: item.id, account: item.account }]));
  const targets: Record<string, Target> = {};
  for (const [key, content, data, brand] of scenarios) {
    targets[key] = await createTarget(prisma, users.admin.id, users.content_owner.id, key, content, data, brand);
  }
  await prisma.finalVideoEvaluation.create({ data: {
    videoId: targets.stale.videoId, contentReviewId: targets.stale.contentId, resultReviewId: targets.stale.resultId,
    ruleEngineResultId: targets.stale.ruleId, triggeredById: users.admin.id, modelProvider: 'openai', modelName: 'fixture',
    contentGrade: 'A', dataGrade: 'A', status: AiReviewStatus.running,
    createdAt: new Date(Date.now() - 20 * 60_000),
  } });
  return { users, password, targets, userIds: created.map((item) => item.id) };
}

async function cleanup(prisma: PrismaClient, fixture: Fixture) {
  const videoIds = Object.values(fixture.targets).map((target) => target.videoId);
  await prisma.operationLog.deleteMany({ where: { videoId: { in: videoIds } } });
  await prisma.finalVideoEvaluation.deleteMany({ where: { videoId: { in: videoIds } } });
  await prisma.ruleEngineResult.deleteMany({ where: { videoId: { in: videoIds } } });
  await prisma.aiResultReview.deleteMany({ where: { videoId: { in: videoIds } } });
  await prisma.videoResultMetric.deleteMany({ where: { videoId: { in: videoIds } } });
  await prisma.supervisorReview.deleteMany({ where: { videoId: { in: videoIds } } });
  await prisma.aiContentReview.deleteMany({ where: { videoId: { in: videoIds } } });
  await prisma.video.deleteMany({ where: { id: { in: videoIds } } });
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
      assert.equal(response.status, 201);
      tokens[role] = (await response.json() as any).accessToken;
    }
    const request = (path: string, role: UserRole, init: RequestInit = {}) => fetch(`${base}${path}`, {
      ...init, headers: { authorization: `Bearer ${tokens[role]}`, 'content-type': 'application/json', ...init.headers },
    });
    const trigger = (key: string, role: UserRole = UserRole.admin) => request(`/api/videos/${fixture!.targets[key].videoId}/final-evaluation`, role, {
      method: 'POST', body: JSON.stringify({ ruleEngineResultId: fixture!.targets[key].ruleId }),
    });
    const run = async () => { const task = tasks.shift(); assert.ok(task); await task(); };

    for (const key of ['effective', 'low-effective', 'low-or-invalid', 'manual', 'invalid']) {
      const response = await trigger(key);
      assert.equal(response.status, 202);
      assert.equal((await response.json() as any).status, 'running');
      await run();
      assert.equal((await prisma.video.findUnique({ where: { id: fixture.targets[key].videoId } }))?.status, VideoStatus.pending_final_confirmation);
    }
    assert.equal((await trigger('content-owner', UserRole.content_owner)).status, 202);
    await run();
    for (const role of [UserRole.supervisor, UserRole.director, UserRole.operator, UserRole.advertiser]) {
      assert.equal((await trigger('denied', role)).status, 403);
    }
    assert.equal(await prisma.finalVideoEvaluation.count({ where: { videoId: fixture.targets.denied.videoId } }), 0);

    const concurrent = await Promise.all([trigger('concurrent'), trigger('concurrent')]);
    assert.deepEqual(concurrent.map((item) => item.status).sort(), [202, 409]);
    assert.equal(tasks.length, 1);
    await run();
    assert.equal((await trigger('concurrent')).status, 409);

    assert.equal((await trigger('failure')).status, 202);
    await run();
    assert.equal((await prisma.video.findUnique({ where: { id: fixture.targets.failure.videoId } }))?.status, VideoStatus.final_evaluation_failed);
    assert.equal((await trigger('failure')).status, 202);
    await run();
    assert.equal(await prisma.finalVideoEvaluation.count({ where: { videoId: fixture.targets.failure.videoId } }), 2);

    assert.equal((await trigger('violation')).status, 202);
    await run();
    assert.equal((await prisma.video.findUnique({ where: { id: fixture.targets.violation.videoId } }))?.status, VideoStatus.final_evaluation_failed);

    assert.equal((await trigger('stale')).status, 202);
    assert.equal(await prisma.operationLog.count({ where: { videoId: fixture.targets.stale.videoId, actionType: 'final_evaluation_recovered' } }), 1);
    await run();

    const latest = await request(`/api/videos/${fixture.targets.effective.videoId}/final-evaluation/latest`, UserRole.admin);
    assert.equal(latest.status, 200);
    const latestBody = await latest.json() as any;
    assert.equal(latestBody.evaluation.status, 'succeeded');
    assert.equal('rawResponse' in latestBody.evaluation, false);
    assert.equal('successKey' in latestBody.evaluation, false);
    const history = await request(`/api/videos/${fixture.targets.failure.videoId}/final-evaluations/history?limit=20`, UserRole.admin);
    assert.equal(history.status, 200);
    assert.equal((await history.json() as any).items.length, 2);

    const evaluations = await prisma.finalVideoEvaluation.findMany({ where: { videoId: { in: Object.values(fixture.targets).map((item) => item.videoId) }, status: AiReviewStatus.succeeded } });
    assert.ok(evaluations.length >= 8);
    for (const evaluation of evaluations) {
      assert.equal(evaluation.finalGrade, null);
      assert.equal(evaluation.finalStatus, null);
      assert.equal(evaluation.isEffectiveFinal, null);
      assert.equal(evaluation.confirmedBy, null);
      assert.equal(evaluation.confirmedAt, null);
      assert.equal(evaluation.canBeUsedForPerformance, false);
      assert.equal(evaluation.isExcellentCase, false);
      assert.equal(evaluation.isNegativeCase, false);
    }
    assert.equal(await prisma.video.count({ where: { id: { in: Object.values(fixture.targets).map((item) => item.videoId) }, status: { in: [VideoStatus.final_effective, VideoStatus.final_low_effective, VideoStatus.final_invalid] } } }), 0);
    assert.ok(await prisma.operationLog.count({ where: { actionType: 'final_evaluation_completed', videoId: { in: Object.values(fixture.targets).map((item) => item.videoId) } } }) >= 8);
    process.stdout.write('Final evaluation HTTP acceptance passed. Suggestions remain unconfirmed and no final video state was written.\n');
  } finally {
    if (app) await app.close();
    if (fixture) await cleanup(prisma, fixture);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  process.stderr.write(`Final evaluation HTTP acceptance failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
