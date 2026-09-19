import 'reflect-metadata';
import { assertIsolatedDatabase } from '../test-support/local-acceptance';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

const url = process.env.OPS_TEST_DATABASE_URL;
if (url) assertIsolatedDatabase(url);

test('isolated PostgreSQL and HTTP management: six-role denial, safe projections, filters, estimates, controlled retry, audit and health', { skip: !url }, async () => {
  process.env.QC_SKIP_DOTENV = '1'; process.env.DATABASE_URL = url; process.env.JWT_SECRET = 'local-operations-test-secret-at-least-32'; process.env.WEB_ORIGIN = 'http://localhost:3000';
  process.env.COS_REGION = 'local-fixture'; process.env.COS_BUCKET = 'local-fixture'; process.env.TENCENTCLOUD_SECRET_ID = 'local-fake-id'; process.env.TENCENTCLOUD_SECRET_KEY = 'local-fake-key';
  const appPath = '../../dist/app.module'; const { AppModule } = await import(appPath);
  const jobsPath = '../../dist/modules/evaluation-jobs/evaluation-jobs.service'; const { EvaluationJobsService } = await import(jobsPath);
  const db = new PrismaClient({ datasourceUrl: url });
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
  const password = 'local-fixture-password'; const users: any[] = [];
  const routes = ['overview', 'jobs', `jobs/${randomUUID()}`, 'ai', 'storage', 'usage', 'usage-summary', 'settings', 'configuration-revisions', 'logs', 'security', 'sessions', 'dependencies'];
  const req = (path: string, cookie?: string, method = 'GET', body?: unknown, csrf = true) => fetch(`${base}/api${path}`, { method, headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', ...(csrf ? { 'X-QC-CSRF': '1' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    for (const role of ['admin', 'content_owner', 'supervisor', 'director', 'operator', 'advertiser', 'visitor'] as const) {
      const user = await db.user.create({ data: { account: `ops-${randomUUID()}`, name: 'Local operations fixture', role, passwordHash: await bcrypt.hash(password, 4), ...(role === 'visitor' ? { expiresAt: new Date(Date.now() + 86400000) } : {}) } });
      const response = await req('/auth/login', undefined, 'POST', { account: user.account, password });
      assert.equal(response.status, 201); const cookie = response.headers.get('set-cookie')!.split(';')[0]; users.push({ ...user, cookie });
      if (role !== 'admin') {
        for (const route of routes) assert.equal((await req(`/admin/operations/${route}`, cookie)).status, 403, `${role} ${route}`);
        for (const [route, method] of [[`jobs/${randomUUID()}/retry`, 'POST'], ['usage/export', 'POST'], ['settings/cost_rates', 'PUT']]) assert.equal((await req(`/admin/operations/${route}`, cookie, method, {})).status, 403, `${role} ${route}`);
      }
    }
    const admin = users[0], director = users.find(u => u.role === 'director');
    for (const path of ['/health', '/health/live', '/health/ready']) assert.equal((await req(path)).status, 200);
    for (const route of routes) assert.equal((await req(`/admin/operations/${route}`)).status, 401);
    assert.equal((await req('/admin/operations/overview', admin.cookie)).status, 200);
    const beforeExpiry = await (await req('/admin/operations/overview', admin.cookie)).json() as any;
    await db.user.create({ data: { account: `expired-${randomUUID()}`, name: 'Expired local fixture', role: 'visitor', passwordHash: 'unused', expiresAt: new Date(0) } });
    const afterExpiry = await (await req('/admin/operations/overview', admin.cookie)).json() as any;
    assert.equal(afterExpiry.activeUsers, beforeExpiry.activeUsers, 'expired accounts must not inflate active user totals');
    assert.equal((await req('/admin/operations/jobs?pageSize=101', admin.cookie)).status, 400);
    assert.equal((await req('/admin/operations/jobs?rawResponse=true', admin.cookie)).status, 400);
    assert.equal((await req('/admin/operations/usage?from=2026-09-10&to=2020-01-01', admin.cookie)).status, 400);
    assert.equal((await req('/admin/operations/settings/API_KEY', admin.cookie, 'PUT', { value: {}, expectedVersion: 0, reason: 'reject', confirmed: true })).status, 400);
    assert.equal((await req('/admin/operations/settings/cost_rates', admin.cookie, 'PUT', { value: {}, expectedVersion: 0, reason: 'reject', confirmed: true }, false)).status, 403);
    const settings = await db.runtimeSetting.findUnique({ where: { key: 'cost_rates' } });
    const rate = { provider: 'aliyun_bailian', modelName: 'ops-fixture', currency: 'CNY', inputPerMillion: 2, outputPerMillion: 8 };
    const input = { value: rate, expectedVersion: settings?.version || 0, reason: 'Local test estimate only', confirmed: true };
    const saved = await req('/admin/operations/settings/cost_rates', admin.cookie, 'PUT', input); assert.equal(saved.status, 200);
    assert.equal((await req('/admin/operations/settings/cost_rates', admin.cookie, 'PUT', input)).status, 409);
    const video = await db.video.create({ data: { title: 'Ops fixture', creatorId: director.id, originalFileName: 'local.mp4', filePath: 'DO-NOT-READ', mimeType: 'video/mp4', fileSizeBytes: 123, videoType: 'other', status: 'ai_content_reviewing' } });
    const review = await db.aiContentReview.create({ data: { videoId: video.id, modelProvider: 'aliyun_bailian', modelName: 'ops-fixture', status: 'running', rawResponse: { secret: 'NEVER_EXPOSE_THIS' }, errorMessage: 'NEVER_EXPOSE_THIS' } });
    const jobs = app.get(EvaluationJobsService);
    const job: any = await db.$transaction(tx => jobs.enqueue(tx, { videoId: video.id, actorId: director.id, stage: 'content', contentReviewId: review.id }));
    // Claim only this isolated fixture, never run a worker or an external model.
    await db.evaluationJob.updateMany({ where: { id: { not: job.id }, status: { in: ['queued', 'retry_wait'] } }, data: { availableAt: new Date('2099-01-01') } });
    const lease = await jobs.claim('local-ops-test'); assert.equal(lease.job.id, job.id);
    await jobs.runWithLease(lease, async () => {
      await jobs.markExternalStarted(); await jobs.markExternalStarted();
      await jobs.recordUsage({ inputTokens: 1000, outputTokens: 500 }, true);
      await db.$transaction(async tx => { await jobs.finishCurrent(tx, 'failed', true); await tx.aiContentReview.update({ where: { id: review.id }, data: { status: 'failed' } }); await tx.video.update({ where: { id: video.id }, data: { status: 'ai_content_failed' } }); });
    });
    const records = await db.aiUsageRecord.findMany({ where: { jobId: job.id } }); assert.equal(records.length, 1); assert.equal(records[0].userId, director.id); assert.equal(records[0].estimatedCost!.toString(), '0.006'); assert.equal(records[0].actualCost, null); assert.equal(records[0].status, 'uncertain');
    const detail = await (await req(`/admin/operations/jobs/${job.id}`, admin.cookie)).json() as any;
    assert.equal(detail.attemptsHistory.length, 1); assert.equal(detail.usage.length, 1);
    for (const field of ['leaseToken', 'fencingToken', 'workerId', 'rawResponse', 'inputRefs', 'errorMessage', 'NEVER_EXPOSE_THIS']) assert.equal(JSON.stringify(detail).includes(field), false, field);
    const list = await (await req(`/admin/operations/jobs?userId=${director.id}&stage=content&status=needs_attention&pageSize=1`, admin.cookie)).json() as any; assert.equal(list.total, 1); assert.equal(list.items[0].id, job.id);
    const summary = await (await req(`/admin/operations/usage-summary?userId=${director.id}`, admin.cookie)).json() as any; assert.equal(summary.groups[0].calls, 1); assert.equal(summary.groups[0].estimatedCost, '0.006'); assert.equal(summary.groups[0].actualCost, null); assert.equal(summary.billingStatus, 'not_connected');
    assert.equal((await req('/admin/operations/usage/export', admin.cookie, 'POST', { reason: ' ', confirmed: true })).status, 400);
    const exported = await req(`/admin/operations/usage/export?userId=${director.id}`, admin.cookie, 'POST', { reason: 'Local controlled export', confirmed: true }); assert.equal(exported.status, 201); const exportData = await exported.json() as any; assert.equal(exportData.count, 1); assert.equal(exportData.csv.includes('rateSnapshot'), false);
    assert.equal(await db.operationLog.count({ where: { userId: admin.id, actionType: 'admin_usage_export' } }), 1);
    assert.equal((await req(`/admin/operations/jobs/${job.id}/retry`, admin.cookie, 'POST', { reason: 'test', confirmed: false })).status, 400);
    const retries = await Promise.all([1, 2].map(() => req(`/admin/operations/jobs/${job.id}/retry`, admin.cookie, 'POST', { reason: 'Reviewed uncertain local fixture', confirmed: true })));
    assert.deepEqual(retries.map(r => r.status).sort(), [201, 409]);
    const retried = await db.evaluationJob.findUnique({ where: { retriedFromId: job.id } }); assert.ok(retried); assert.equal(retried.actorId, director.id); assert.notEqual(retried.contentReviewId, review.id);
    assert.deepEqual((await db.aiContentReview.findUnique({ where: { id: review.id } }))!.rawResponse, { secret: 'NEVER_EXPOSE_THIS' });
    assert.equal(await db.operationLog.count({ where: { userId: admin.id, actionType: 'admin_evaluation_retry', targetId: retried.id } }), 1);
    const storage = await (await req('/admin/operations/storage', admin.cookie)).json() as any; assert.equal(storage.cos.configured, true); assert.equal(storage.cos.remoteInventory, 'not_connected'); assert.equal(storage.cloudBilling, 'not_connected');
    const deps = await (await req('/admin/operations/dependencies', admin.cookie)).json() as any; assert.equal(deps.resources, 'not_connected'); assert.equal(deps.paidDiagnostic, 'manual_only_not_executed');
    const logs = await (await req('/admin/operations/logs', admin.cookie)).json(); assert.equal(JSON.stringify(logs).includes('beforeValue'), false); assert.equal(JSON.stringify(logs).includes('userAgent'), false);
    const sessions = await (await req('/admin/operations/sessions', admin.cookie)).json() as any; assert.ok(sessions.items.some((s: any) => s.userId === admin.id && s.active)); assert.equal(JSON.stringify(sessions).includes('passwordHash'), false);
    await jobs.recordTemporaryStorage(`ops-${randomUUID()}`, 'cleanup_failed');
    const storageAfter = await (await req('/admin/operations/storage', admin.cookie)).json() as any; assert.ok(storageAfter.temporaryObjects.some((r: any) => r.status === 'cleanup_failed'));
    const servicePath = '../../dist/modules/admin/admin-operations.service'; const { AdminOperationsService } = await import(servicePath);
    const operations = app.get(AdminOperationsService);
    await db.user.update({ where: { id: admin.id }, data: { status: 'disabled' } });
    await assert.rejects(operations.exportUsage({}, { reason: 'stale authorization', confirmed: true }, admin), /Administrator|管理员/);
  } finally { await app.close(); await db.$disconnect(); }
});
