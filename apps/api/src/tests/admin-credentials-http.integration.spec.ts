import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { configureLocalAcceptance } from '../test-support/local-acceptance';

const url = process.env.ADMIN_CREDENTIAL_TEST_DATABASE_URL;
if (url) configureLocalAcceptance(url);

test('isolated HTTP credential contracts enforce DTOs, guards, login and session invalidation', { skip: !url, timeout: 120000 }, async () => {
  configureLocalAcceptance(url);
  const db = new PrismaClient({ datasourceUrl: url });
  const appPath = '../../dist/app.module';
  const { AppModule } = await import(appPath);
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(), ids: string[] = [];
  const prefix = `FixtureOnly-HTTP-${randomUUID()}`;
  const oldPassword = 'FixtureOnly-Old-123', newPassword = 'FixtureOnly-New-123';
  const reason = 'FixtureOnly credential acceptance';
  const request = (path: string, cookie = '', method = 'GET', body?: unknown) => fetch(base + '/api' + path, {
    method, headers: { Origin: 'http://localhost:3000', 'X-QC-CSRF': '1', 'Content-Type': 'application/json', Cookie: cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const login = async (account: string, password: string) => {
    const response = await request('/auth/login', '', 'POST', { account, password });
    assert.equal(response.status, 201);
    return { cookie: response.headers.get('set-cookie')!.split(';')[0], body: await response.json() as any };
  };
  try {
    const admin = await db.user.create({ data: { account: prefix, name: 'FixtureOnly admin', role: 'admin', passwordHash: await bcrypt.hash(oldPassword, 4) } }); ids.push(admin.id);
    const adminLogin = await login(admin.account, oldPassword);
    const created = await request('/admin/users', adminLogin.cookie, 'POST', { account: '  ' + prefix + ' 中文  ', name: 'FixtureOnly target', role: 'director', initialPassword: 'Fixture8', mustChangePassword: false, reason });
    assert.equal(created.status, 201);
    const initial: any = await created.json(); ids.push(initial.user.id);
    assert.equal(initial.user.account, prefix + ' 中文'); assert.equal(initial.user.mustChangePassword, false);
    assert.equal(initial.initialPassword, 'Fixture8'); assert.equal(initial.user.passwordHash, undefined);
    const original = await login(initial.user.account, initial.initialPassword);
    const renamedAccount = prefix + ' 新账户';
    const renamed = await request('/admin/users/' + initial.user.id, adminLogin.cookie, 'PATCH', { account: renamedAccount, reason });
    assert.equal(renamed.status, 200); assert.equal((await request('/auth/me', original.cookie)).status, 401);
    assert.equal((await request('/admin/users/' + initial.user.id, adminLogin.cookie, 'PATCH', { account: admin.account, reason })).status, 409);
    assert.equal((await request('/admin/users/' + initial.user.id, adminLogin.cookie, 'PATCH', { account: '\tbad-account', reason })).status, 400);
    const renamedLogin = await login(renamedAccount, initial.initialPassword);
    for (const input of [
      { password: 'short-7', mustChangePassword: false, reason },
      { password: 'x'.repeat(129), mustChangePassword: false, reason },
      { password: '密'.repeat(25), mustChangePassword: false, reason },
      { password: newPassword, reason },
      { password: newPassword, mustChangePassword: false, reason: '  ' },
      { password: newPassword, mustChangePassword: false, reason, passwordHash: 'forbidden' },
    ]) assert.equal((await request(`/admin/users/${initial.user.id}/set-password`, adminLogin.cookie, 'POST', input)).status, 400);
    assert.equal(await db.operationLog.count({ where: { targetId: initial.user.id, actionType: 'admin_password_set' } }), 0);
    const endpoint = `/admin/users/${initial.user.id}/set-password`;
    assert.equal((await request(endpoint, '', 'POST', { password: newPassword, mustChangePassword: false, reason })).status, 401);
    assert.equal((await request(endpoint, renamedLogin.cookie, 'POST', { password: newPassword, mustChangePassword: false, reason })).status, 403);
    const assigned = await request(endpoint, adminLogin.cookie, 'POST', { password: newPassword, mustChangePassword: false, reason });
    assert.equal(assigned.status, 201); assert.deepEqual(await assigned.json(), { success: true });
    assert.equal((await request('/auth/me', renamedLogin.cookie)).status, 401);
    assert.equal((await login(renamedAccount, newPassword)).body.user.mustChangePassword, false);
    await request(endpoint, adminLogin.cookie, 'POST', { password: newPassword, mustChangePassword: true, reason });
    const temporary = await login(renamedAccount, newPassword);
    assert.equal(temporary.body.user.mustChangePassword, true);
    assert.equal((await request('/videos', temporary.cookie)).status, 403);
    const self = await request(`/admin/users/${admin.id}/set-password`, adminLogin.cookie, 'POST', { password: newPassword, mustChangePassword: false, reason });
    assert.equal(self.status, 201); assert.equal((await request('/auth/me', adminLogin.cookie)).status, 401);
    assert.equal((await login(admin.account, newPassword)).body.user.role, 'admin');
    const audits = await db.operationLog.findMany({ where: { targetId: { in: ids }, actionType: 'admin_password_set' } });
    assert.equal(audits.length, 3);
    for (const audit of audits) assert.deepEqual(Object.keys(audit.afterValue as object), ['mustChangePassword']);
    const serialized = JSON.stringify(audits);
    assert(!serialized.includes(oldPassword) && !serialized.includes(newPassword) && !serialized.includes('passwordHash'));
  } finally {
    await app.close();
    await db.operationLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { targetId: { in: ids } }] } });
    await db.userSession.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
