import 'reflect-metadata';
import { assertIsolatedDatabase } from '../test-support/local-acceptance';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

const url = process.env.IDENTITY_TEST_DATABASE_URL;
if (url) assertIsolatedDatabase(url);
test('HTTP identity: cookie only, CSRF, first password, revocation, visitor resource denials and admin lifecycle', { skip: !url }, async () => {
  assertIsolatedDatabase(url);
  process.env.DATABASE_URL = url; process.env.WEB_ORIGIN = 'http://localhost:3000';
  process.env.JWT_SECRET = 'isolated-http-test-secret-with-at-least-32-characters';
  // Nest's runtime DI needs emitted decorator metadata; tsx does not emit it.
  const appPath = '../../dist/app.module';
  const { AppModule } = await import(appPath);
  const db = new PrismaClient({ datasourceUrl: url });
  const password = 'test-password-12';
  const user = await db.user.create({ data: { account: randomUUID(), name: 'HTTP test', role: 'visitor', passwordHash: await bcrypt.hash(password, 4), expiresAt: new Date(Date.now() + 3600000), mustChangePassword: true } });
  const admin = await db.user.create({ data: { account: randomUUID(), name: 'Admin test', role: 'admin', passwordHash: await bcrypt.hash(password, 4) } });
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
  async function req(path: string, method = 'GET', body?: unknown, cookie?: string, headers: Record<string, string> = {}) {
    return fetch(`${base}/api${path}`, { method, headers: { Origin: 'http://localhost:3000', 'X-QC-CSRF': '1', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  try {
    const login = await req('/auth/login', 'POST', { account: user.account, password });
    assert.equal(login.status, 201);
    const setCookie = login.headers.get('set-cookie');
    assert.ok(setCookie?.includes('qc_session='), 'login must issue server-backed session cookie');
    assert.match(setCookie!, /HttpOnly/i); assert.match(setCookie!, /SameSite=Lax/i);
    const cookie = setCookie!.split(';')[0];
    const data: any = await login.json(); assert.equal(data.accessToken, undefined); assert.equal(data.user.mustChangePassword, true);
    assert.equal((await req('/auth/me', 'GET', undefined, cookie)).status, 200);
    assert.equal((await req('/videos', 'GET', undefined, cookie)).status, 403);
    assert.equal((await req('/auth/change-password', 'POST', { currentPassword: password, newPassword: 'better-password-12' }, cookie, { 'X-QC-CSRF': '' })).status, 403);
    assert.equal((await req('/auth/login', 'POST', { account: user.account, password }, undefined, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await req('/auth/login', 'POST', { account: user.account, password, adminOnly: true })).status, 401);
    const changed = await req('/auth/change-password', 'POST', { currentPassword: password, newPassword: 'better-password-12' }, cookie);
    assert.equal(changed.status, 201); const fresh = changed.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await req('/auth/me', 'GET', undefined, cookie)).status, 401);
    assert.equal((await req('/auth/me', 'GET', undefined, undefined, { Authorization: `Bearer ${fresh.split('=')[1]}` })).status, 401);
    const otherVideo = await db.video.create({ data: { title: 'Not owned', creatorId: admin.id, originalFileName: 'test.mp4', filePath: 'not-read', mimeType: 'video/mp4', fileSizeBytes: 1, videoType: 'other' } });
    const ownVideo = await db.video.create({ data: { title: 'Owned', creatorId: user.id, isTrial: true, originalFileName: 'test.mp4', filePath: 'not-read', mimeType: 'video/mp4', fileSizeBytes: 1, videoType: 'other' } });
    assert.equal((await req(`/videos/${ownVideo.id}`, 'GET', undefined, fresh)).status, 200);
    const ownDetail: any = await (await req(`/videos/${ownVideo.id}`, 'GET', undefined, fresh)).json();
    assert.equal('resultMetrics' in ownDetail, false); assert.equal(ownDetail.isTrial, true);
    for (const suffix of ['', '/file', '/file-url', '/content-review/latest']) assert.equal((await req(`/videos/${otherVideo.id}${suffix}`, 'GET', undefined, fresh)).status, 403, suffix);
    const otherReview = await db.aiContentReview.create({ data: { videoId: otherVideo.id, modelProvider: 'test', modelName: 'test', status: 'failed' } });
    const otherJob = await db.evaluationJob.create({ data: { videoId: otherVideo.id, actorId: admin.id, stage: 'content', contentReviewId: otherReview.id, status: 'failed' } });
    assert.equal((await req(`/evaluation-jobs/${otherJob.id}`, 'GET', undefined, fresh)).status, 403);
    const ownResultReview = await db.aiResultReview.create({ data: { videoId: ownVideo.id, modelProvider: 'test', modelName: 'test', status: 'failed' } });
    const ownFinalJob = await db.evaluationJob.create({ data: { videoId: ownVideo.id, actorId: user.id, stage: 'result', resultReviewId: ownResultReview.id, status: 'failed' } });
    assert.equal((await req(`/evaluation-jobs/${ownFinalJob.id}`, 'GET', undefined, fresh)).status, 403);
    assert.equal((await req(`/videos/${ownVideo.id}/case-marking`, 'PUT', {}, fresh)).status, 403);
    for (const route of ['/admin/users', '/admin/roles', '/cases', '/dashboard/summary', '/platform-benchmarks', '/videos/00000000-0000-4000-8000-000000000000/result-metrics/latest', '/videos/00000000-0000-4000-8000-000000000000/result-review/latest', '/videos/00000000-0000-4000-8000-000000000000/rule-engine/latest', '/videos/00000000-0000-4000-8000-000000000000/final-evaluation/latest']) {
      assert.equal((await req(route, 'GET', undefined, fresh)).status, 403, route);
    }
    for (const route of ['supervisor-review', 'result-metrics', 'result-review', 'rule-engine', 'final-evaluation', 'final-confirmation']) {
      assert.equal((await req(`/videos/00000000-0000-4000-8000-000000000000/${route}`, 'POST', {}, fresh)).status, 403, route);
    }
    await db.user.update({ where: { id: user.id }, data: { expiresAt: new Date(0) } });
    assert.equal((await req('/auth/me', 'GET', undefined, fresh)).status, 401);
    assert.equal((await req('/videos/00000000-0000-4000-8000-000000000000/file-url', 'GET', undefined, fresh)).status, 401);
    const failedBefore = await db.operationLog.count({ where: { userId: user.id, actionType: 'login_failed' } });
    assert.equal((await req('/auth/login', 'POST', { account: user.account, password: 'better-password-12' })).status, 401);
    assert.equal(await db.operationLog.count({ where: { userId: user.id, actionType: 'login_failed' } }), failedBefore + 1);
    const adminLogin = await req('/auth/login', 'POST', { account: admin.account, password, adminOnly: true });
    const adminCookie = adminLogin.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await req('/admin/users', 'GET', undefined, adminCookie)).status, 200);
    const created = await req('/admin/users', 'POST', { account: `visitor-${randomUUID()}`, name: 'Managed visitor', role: 'visitor', expiresAt: new Date(Date.now() + 3600000).toISOString(), quotas: [{ kind: 'upload_count', period: 'daily', limit: 2 }, { kind: 'storage_bytes', period: 'lifetime', limit: 1024 }, { kind: 'content_evaluations', period: 'monthly', limit: 3 }], reason: 'HTTP test' }, adminCookie);
    assert.equal(created.status, 201); const createdData: any = await created.json();
    assert.equal(createdData.user.createdById, admin.id); assert.equal(createdData.user.mustChangePassword, true);
    assert.equal(createdData.user.passwordHash, undefined); assert.ok(createdData.initialPassword.length >= 12);
    const listed: any = await (await req('/admin/users?search=visitor-&pageSize=10', 'GET', undefined, adminCookie)).json();
    assert.equal(JSON.stringify(listed).includes(createdData.initialPassword), false);
    const managedId = createdData.user.id;
    const detailResponse = await req(`/admin/users/${managedId}`, 'GET', undefined, adminCookie);
    assert.equal(detailResponse.status, 200);
    const detail: any = await detailResponse.json();
    assert.equal(detail.user.id, managedId); assert.equal(detail.user.passwordHash, undefined);
    assert.equal((await req(`/admin/users/${managedId}/quotas`, 'GET', undefined, adminCookie)).status, 200);
    assert.equal((await req(`/admin/users/${managedId}/quotas/adjust`, 'POST', { kind: 'upload_count', period: 'daily', reason: 'test', businessKey: randomUUID() }, adminCookie)).status, 400);
    assert.equal((await req(`/admin/users/${managedId}`, 'PATCH', { role: null, reason: 'test' }, adminCookie)).status, 400);
    const managedLogin = await req('/auth/login', 'POST', { account: createdData.user.account, password: createdData.initialPassword });
    const managedCookie = managedLogin.headers.get('set-cookie')!.split(';')[0];
    const sessions: any = await (await req(`/admin/users/${managedId}/sessions`, 'GET', undefined, adminCookie)).json();
    assert.equal((await req(`/admin/users/${admin.id}/sessions/${sessions.items[0].id}/revoke`, 'POST', { reason: 'wrong target' }, adminCookie)).status, 404);
    const reset = await req(`/admin/users/${managedId}/reset-password`, 'POST', { reason: 'test reset' }, adminCookie);
    assert.equal(reset.status, 201); assert.equal((await req('/auth/me', 'GET', undefined, managedCookie)).status, 401);
    assert.equal((await req(`/admin/users/${managedId}/archive`, 'POST', { reason: 'test archive' }, adminCookie)).status, 201);
    assert.equal((await req(`/admin/users/${managedId}`, 'PATCH', { status: 'active', reason: 'restore' }, adminCookie)).status, 409);
    assert.equal((await req('/admin/users/batch', 'POST', { users: Array(21).fill({}) }, adminCookie)).status, 400);
    assert.equal((await req('/auth/change-password', 'POST', { currentPassword: password, newPassword: '密'.repeat(25) }, adminCookie)).status, 400);
    assert.equal((await req('/auth/login', 'POST', { account: admin.account, password }, undefined, { 'sec-fetch-site': 'cross-site' })).status, 403);
    const invalid = await req('/admin/users', 'POST', { account: randomUUID(), name: 'No expiry', role: 'visitor', reason: 'test' }, adminCookie);
    assert.equal(invalid.status, 400);
    assert.equal((await req('/auth/logout', 'POST', {}, adminCookie)).status, 201);
    assert.equal((await req('/auth/me', 'GET', undefined, adminCookie)).status, 401);
    const attempts = await Promise.all(Array.from({ length: 12 }, () => req('/auth/login', 'POST', { account: 'invalid', password: 'incorrect-12345' })));
    assert.ok(attempts.some((r) => r.status === 429));
  } finally { await app.close(); await db.$disconnect(); }
});

test('last active administrator changes serialize and preserve an administrator', { skip: !url }, async () => {
  const modulePath = '../modules/admin/admin-users.service';
  const mod = await import(modulePath).catch(() => ({}));
  assert.equal(typeof mod.AdminUsersService, 'function', 'admin lifecycle service must exist');
  const quotaPath = '../modules/quotas/quotas.service'; const { QuotasService } = await import(quotaPath);
  const db = new PrismaClient({ datasourceUrl: url });
  // Dedicated database: formal users from other tests are not administrators except the HTTP fixture.
  await db.user.updateMany({ where: { role: 'admin' }, data: { status: 'disabled' } });
  const a = await db.user.create({ data: { account: randomUUID(), name: 'Admin A', role: 'admin', passwordHash: 'unused' } });
  const b = await db.user.create({ data: { account: randomUUID(), name: 'Admin B', role: 'admin', passwordHash: 'unused' } });
  const service = new mod.AdminUsersService(db, new QuotasService(db));
  try {
    const results = await Promise.allSettled([service.update(a.id, { role: 'director', reason: 'test' }, a), service.update(b.id, { status: 'disabled', reason: 'test' }, b)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await db.user.count({ where: { role: 'admin', status: 'active' } }), 1);
  } finally { await db.$disconnect(); }
});
