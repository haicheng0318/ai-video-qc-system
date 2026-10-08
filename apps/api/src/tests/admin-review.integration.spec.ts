import 'reflect-metadata';
import { assertIsolatedDatabase } from '../test-support/local-acceptance';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
const url = process.env.OPS_TEST_DATABASE_URL;
if (url) assertIsolatedDatabase(url);
test('review fixes: benchmark boundary, denial audit, trial attribution, model/log filters, dates and operational statistics', { skip: !url }, async () => {
  process.env.QC_SKIP_DOTENV = '1'; process.env.DATABASE_URL = url; process.env.JWT_SECRET = 'local-review-round-one-test-secret-32'; process.env.WEB_ORIGIN = 'http://localhost:3000';
  const db = new PrismaClient({ datasourceUrl: url }); const path = '../../dist/app.module'; const { AppModule } = await import(path);
  const app = await NestFactory.create(AppModule, { logger: false }); app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const req = (route: string, cookie = '', method = 'GET', body?: any) => fetch(`${base}/api${route}`, { method, headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'X-QC-CSRF': '1', Cookie: cookie }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const accounts: any[] = [];
  try {
    for (const role of ['admin', 'content_owner', 'visitor'] as const) { const user = await db.user.create({ data: { account: randomUUID(), name: 'review local', role, passwordHash: await bcrypt.hash('local-password-test', 4), expiresAt: new Date(Date.now() + 86400000) } }); const r = await req('/auth/login', '', 'POST', { account: user.account, password: 'local-password-test' }); accounts.push({ ...user, cookie: r.headers.get('set-cookie')!.split(';')[0] }); }
    const [admin, owner, visitor] = accounts;
    for (const user of [owner, visitor]) {
      assert.equal((await req('/platform-benchmarks', user.cookie)).status, 403);
      assert.equal((await req('/platform-benchmarks', user.cookie, 'POST', {})).status, 403);
      assert.equal((await req('/admin/operations/overview?secret=not-logged', user.cookie)).status, 403);
      const events = await (await req(`/admin/operations/security?userId=${user.id}&actionType=management_access_denied`, admin.cookie)).json() as any;
      assert.equal(events.total, 3); assert.equal(JSON.stringify(events).includes('not-logged'), false);
    }
    const modelName = `fixture-${randomUUID()}`;
    for (const isTrial of [false, true]) {
      const v = await db.video.create({ data: { title: 'mixed usage', creatorId: visitor.id, isTrial, originalFileName: 'local.mp4', filePath: 'NOT-READ', mimeType: 'video/mp4', fileSizeBytes: 1, videoType: 'other', createdAt: new Date('2026-01-02T00:00:00Z') } });
      const review = await db.aiContentReview.create({ data: { videoId: v.id, modelProvider: 'test', modelName, status: 'succeeded' } });
      const j = await db.evaluationJob.create({ data: { videoId: v.id, contentReviewId: review.id, actorId: visitor.id, stage: 'content', status: 'succeeded', createdAt: new Date('2026-01-02T00:00:00Z'), completedAt: new Date('2026-01-02T00:00:20Z') } });
      const a = await db.evaluationJobAttempt.create({ data: { jobId: j.id, attemptNumber: 1, fencingToken: randomUUID(), workerId: 'test', status: 'succeeded', startedAt: new Date('2026-01-02T00:00:05Z'), completedAt: new Date('2026-01-02T00:00:20Z') } });
      await db.aiUsageRecord.create({ data: { jobId: j.id, attemptId: a.id, userId: visitor.id, isTrial, stage: 'content', provider: 'test', modelName, status: 'succeeded', inputTokens: isTrial ? 30 : 10, outputTokens: 5, createdAt: new Date('2026-01-02T00:00:05Z') } });
    }
    await db.user.update({ where: { id: visitor.id }, data: { role: 'director' } });
    for (const [scope, input] of [['formal', 10], ['trial', 30]] as const) {
      const query = `userId=${visitor.id}&scope=${scope}&modelName=${modelName}`;
      const listing = await (await req(`/admin/operations/usage?${query}`, admin.cookie)).json() as any; assert.equal(listing.total, 1); assert.equal(listing.items[0].inputTokens, input); assert.equal(listing.items[0].isTrial, scope === 'trial');
      const summary = await (await req(`/admin/operations/usage-summary?${query}`, admin.cookie)).json() as any; assert.equal(summary.groups.length, 1); assert.equal(summary.groups[0].isTrial, scope === 'trial');
      const csv = await (await req(`/admin/operations/usage/export?${query}`, admin.cookie, 'POST', { reason: 'scope export', confirmed: true })).json() as any; assert.equal(csv.count, 1); assert.ok(csv.csv.includes('isTrial'));
      const tasks = await (await req(`/admin/operations/jobs?userId=${visitor.id}&scope=${scope}`, admin.cookie)).json() as any; assert.equal(tasks.total, 1); assert.equal(tasks.items[0].waitingSeconds, 5); assert.equal(tasks.items[0].processingSeconds, 15);
    }
    const stats = await (await req(`/admin/operations/job-statistics?userId=${visitor.id}`, admin.cookie)).json() as any;
    assert.equal(stats.groups.length, 2); assert.equal(stats.groups[0].successRate, 1); assert.equal(stats.groups[0].processingP95, 15);
    const overview = await (await req('/admin/operations/overview?from=2026-01-01T00:00:00Z&to=2026-01-03T00:00:00Z', admin.cookie)).json() as any;
    assert.ok(overview.formalVideos >= 1); assert.ok(overview.trialVideos >= 1); assert.ok(Array.isArray(overview.currentBacklog)); assert.ok(Array.isArray(overview.expiringAccounts));
    assert.ok(overview.jobs.every((j: any) => typeof j.isTrial === 'boolean'));
    const currentRetention = await db.runtimeSetting.findUnique({ where: { key: 'retention' } });
    assert.equal((await req('/admin/operations/settings/retention', admin.cookie, 'PUT', { value: { temporaryHours: 24, auditDays: 365 }, expectedVersion: currentRetention?.version || 0, reason: 'review retention', confirmed: true })).status, 200);
    await db.temporaryStorageRecord.create({ data: { objectPath: `NO-REMOTE-${randomUUID()}`, provider: 'oss', status: 'cleanup_failed', createdAt: new Date(0) } });
    const storage = await (await req('/admin/operations/storage', admin.cookie)).json() as any; assert.ok(storage.retentionReview.temporaryObjects >= 1); assert.equal(storage.retentionReview.deletion, 'manual_only');
    const setting = await db.runtimeSetting.findUnique({ where: { key: 'evaluation_parameters' } });
    assert.equal((await req('/admin/operations/settings/evaluation_parameters', admin.cookie, 'PUT', { value: { stage: 'result', modelName: 'local-policy-test', maxOutputTokens: 1024 }, expectedVersion: setting?.version || 0, reason: 'local policy test', confirmed: true })).status, 200);
    assert.equal((await db.aiModelConfig.findFirst({ where: { agentType: 'result_review', enabled: true } }))?.maxTokens, 1024);
    const log = await db.operationLog.create({ data: { userId: admin.id, targetType: 'review_fixture', targetId: randomUUID(), actionType: 'test_event', result: 'success', afterValue: { secret: 'HIDDEN' } } });
    const q = `actionType=test_event&targetType=review_fixture&targetId=${log.targetId}&result=success`;
    assert.equal(((await (await req(`/admin/operations/logs?${q}`, admin.cookie)).json()) as any).total, 1);
    const logCsv = await (await req(`/admin/operations/logs/export?${q}`, admin.cookie, 'POST', { reason: 'local export', confirmed: true })).json() as any; assert.equal(logCsv.count, 1); assert.equal(logCsv.csv.includes('HIDDEN'), false);
    const jobsPath = '../../dist/modules/evaluation-jobs/evaluation-jobs.service'; const { EvaluationJobsService } = await import(jobsPath); const jobs = app.get(EvaluationJobsService);
    const rulePath = '../../dist/modules/rule-engine/rule-engine.rules'; const { evaluateRuleBoundary } = await import(rulePath);
    for (const stage of ['result', 'final']) for (const stale of [false, true]) {
      const video = await db.video.create({ data: { title: 'Legacy recovery', creatorId: admin.id, originalFileName: 'not-read.mp4', filePath: 'NOT-READ', mimeType: 'video/mp4', fileSizeBytes: 1, videoType: 'other', status: stage === 'result' ? 'ai_result_reviewing' : 'pending_final_evaluation' } });
      const content = await db.aiContentReview.create({ data: { videoId: video.id, modelProvider: 'test', modelName: 'local', status: 'succeeded', contentGrade: 'A' } });
      await db.supervisorReview.create({ data: { videoId: video.id, reviewerId: admin.id, decision: 'approved_for_publish', isAllowedToPublish: true } });
      const metric = await db.videoResultMetric.create({ data: { videoId: video.id, submittedBy: admin.id, videoType: 'other', createdAt: new Date('2026-01-01') } });
      const result = await db.aiResultReview.create({ data: { videoId: video.id, resultMetricId: metric.id, modelProvider: 'test', modelName: 'local', status: stage === 'result' ? 'running' : 'succeeded', dataGrade: 'A', dataSufficiency: 'sufficient', createdAt: new Date('2026-01-02') } });
      if (stage === 'final') {
        const rule = await db.ruleEngineResult.create({ data: { videoId: video.id, contentReviewId: content.id, resultReviewId: result.id, ...evaluateRuleBoundary({ contentGrade: 'A', dataGrade: 'A', dataSufficiency: 'sufficient' }) } });
        await db.finalVideoEvaluation.create({ data: { videoId: video.id, contentReviewId: content.id, resultReviewId: result.id, ruleEngineResultId: rule.id, triggeredById: admin.id, modelProvider: 'test', modelName: 'local', contentGrade: 'A', dataGrade: 'A', status: 'running' } });
      }
      if (stale) await db.videoResultMetric.create({ data: { videoId: video.id, submittedBy: admin.id, videoType: 'other' } });
      await jobs.recoverOrphans();
      const old = await db.evaluationJob.findFirstOrThrow({ where: { videoId: video.id, stage } }); assert.equal(old.status, 'needs_attention'); assert.deepEqual(old.inputRefs, {});
      const retry = await req(`/admin/operations/jobs/${old.id}/retry`, admin.cookie, 'POST', { reason: 'Review durable legacy source', confirmed: true });
      assert.equal(retry.status, stale ? 409 : 201, `${stage} stale=${stale}: ${await retry.text()}`);
      const replacement = await db.evaluationJob.findUnique({ where: { retriedFromId: old.id } });
      if (stale) assert.equal(replacement, null); else { assert.ok(replacement); assert.notDeepEqual(replacement.inputRefs, {}); assert.equal(await db.operationLog.count({ where: { targetId: replacement.id, actionType: 'admin_evaluation_retry' } }), 1); }
    }
  } finally { await app.close(); await db.$disconnect(); }
});
