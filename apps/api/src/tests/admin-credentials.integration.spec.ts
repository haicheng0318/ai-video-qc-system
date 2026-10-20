import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { assertIsolatedDatabase } from '../test-support/local-acceptance';
import { AdminUsersService } from '../modules/admin/admin-users.service';
import { AuthService } from '../modules/auth/auth.service';
import { JwtStrategy } from '../modules/auth/jwt.strategy';
import { QuotasService } from '../modules/quotas/quotas.service';

// Never fall back to DATABASE_URL or load dotenv. Only this task-specific opt-in can connect.
const url = process.env.ADMIN_CREDENTIAL_TEST_DATABASE_URL;
if (url) {
  assertIsolatedDatabase(url);
  if (process.env.QC_LOCAL_ACCEPTANCE !== '1' || process.env.NODE_ENV === 'production') throw Error('Credential integration requires explicit isolated local acceptance.');
}

test('isolated credential lifecycle: login combinations, sessions, audit, collisions and atomic rollback', { skip: !url, timeout: 120000 }, async () => {
  assertIsolatedDatabase(url);
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'FixtureOnly-Credential-Integration-Secret-123';
  const db = new PrismaClient({ datasourceUrl: url });
  const service: any = new AdminUsersService(db as any, new QuotasService(db as any));
  const jwt = new JwtService({ secret: process.env.JWT_SECRET });
  const auth = new AuthService(db as any, jwt);
  const strategy = new JwtStrategy(db as any);
  const prefix = `FixtureOnly-Credentials-${randomUUID()}`;
  const oldPassword = 'FixtureOnly-Old-123'; const newPassword = 'FixtureOnly-New-123';
  const reason = 'Fixture-only isolated credential integration';
  const ids: string[] = [];
  const payload = (token: string) => jwt.verify<{ sub: string; sid: string }>(token);
  const login = (account: string, password: string) => auth.login({ account, password }, {});
  const activeSessions = (id: string) => db.userSession.count({ where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } } });
  const seed = async (suffix: string, role: 'admin' | 'director' = 'director') => {
    const user = await db.user.create({ data: { account: `${prefix}-${suffix}`, name: 'Fixture only', role, passwordHash: await bcrypt.hash(oldPassword, 4), mustChangePassword: false } });
    ids.push(user.id); return user;
  };
  async function rejectOldSessions(tokens: string[]) {
    for (const token of tokens) await assert.rejects(strategy.validate(payload(token)), UnauthorizedException);
  }
  try {
    const admin = await seed('admin', 'admin');
    const secondAdmin = await seed('admin2', 'admin');
    const target = await seed('target');
    const oldAccount = target.account; const newAccount = `${prefix}-新账号 Mixed`;
    const originalSessions = await Promise.all([login(oldAccount, oldPassword), login(oldAccount, oldPassword), login(oldAccount, oldPassword)]);
    assert.equal(await activeSessions(target.id), 3);
    await service.update(target.id, { account: ` ${newAccount} `, reason }, admin);
    assert.equal(await activeSessions(target.id), 0);
    await rejectOldSessions(originalSessions.map(session => session.token));
    assert.equal(await db.user.count({ where: { id: target.id, account: newAccount } }), 1);
    const afterRename = await Promise.all([login(newAccount, oldPassword), login(newAccount, oldPassword)]);
    assert.equal(await activeSessions(target.id), 2);
    assert.deepEqual(await service.setPassword(target.id, { password: newPassword, mustChangePassword: false, reason }, admin), { success: true });
    assert.equal(await activeSessions(target.id), 0); await rejectOldSessions(afterRename.map(session => session.token));
    for (const [account, password] of [[oldAccount, oldPassword], [oldAccount, newPassword], [newAccount, oldPassword]]) await assert.rejects(login(account, password), UnauthorizedException);
    const correct = await login(newAccount, newPassword); assert.equal(correct.user.mustChangePassword, false);
    assert.equal((await strategy.validate(payload(correct.token))).id, target.id);
    await service.setPassword(target.id, { password: oldPassword, mustChangePassword: true, reason }, admin);
    assert.equal((await login(newAccount, oldPassword)).user.mustChangePassword, true);
    const reset = await service.resetPassword(target.id, reason, admin);
    assert.ok(typeof reset.initialPassword === 'string'); assert.equal(await activeSessions(target.id), 0);
    await assert.rejects(login(newAccount, oldPassword), UnauthorizedException);
    assert.equal((await login(newAccount, reset.initialPassword)).user.mustChangePassword, true);

    const unchangedSession = await login(secondAdmin.account, oldPassword);
    await service.update(secondAdmin.id, { account: ` ${secondAdmin.account} `, name: 'Fixture display rename', reason }, admin);
    assert.equal((await strategy.validate(payload(unchangedSession.token))).id, secondAdmin.id);
    const self = await login(admin.account, oldPassword);
    await service.update(admin.id, { account: `${prefix}-self-renamed`, reason }, admin);
    await rejectOldSessions([self.token]);
    const selfAgain = await login(`${prefix}-self-renamed`, oldPassword);
    await service.setPassword(admin.id, { password: newPassword, mustChangePassword: false, reason }, admin);
    await rejectOldSessions([selfAgain.token]);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).role, 'admin');

    const a = await seed('collision-a'), b = await seed('collision-b');
    const collisionSessions = await Promise.all([login(a.account, oldPassword), login(b.account, oldPassword)]);
    const sharedAccount = `${prefix}-same-account`;
    const race = await Promise.allSettled([service.update(a.id, { account: sharedAccount, reason }, admin), service.update(b.id, { account: sharedAccount, reason }, secondAdmin)]);
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
    const failed = race.find(result => result.status === 'rejected') as PromiseRejectedResult;
    assert.equal(failed.reason.getStatus(), 409);
    assert.equal(await db.user.count({ where: { account: sharedAccount } }), 1);
    assert.equal(await db.operationLog.count({ where: { targetId: { in: [a.id, b.id] }, actionType: 'account_updated' } }), 1, 'Only the winning rename may be audited as successful');
    const winner = await db.user.findUniqueOrThrow({ where: { account: sharedAccount } });
    for (let index = 0; index < 2; index++) {
      const user = [a, b][index];
      if (user.id === winner.id) { await rejectOldSessions([collisionSessions[index].token]); assert.equal(await activeSessions(user.id), 0); }
      else { assert.equal((await strategy.validate(payload(collisionSessions[index].token))).id, user.id); assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).account, user.account); }
    }

    // Use real Prisma transactions; inject only the audit failure after user/session writes.
    const rollbackUser = await seed('rollback'); const rollbackSession = await login(rollbackUser.account, oldPassword);
    const failingDb: any = { $transaction: (work: any, options: any) => db.$transaction(async tx => {
      const wrapped = new Proxy(tx, { get(object, key) {
        if (key === 'operationLog') return new Proxy(tx.operationLog, { get(delegate, method) { if (method === 'create') return async () => { throw Error('Fixture audit rollback'); }; const value = Reflect.get(delegate, method); return typeof value === 'function' ? value.bind(delegate) : value; } });
        const value = Reflect.get(object, key); return typeof value === 'function' ? value.bind(object) : value;
      } });
      return work(wrapped);
    }, options) };
    const failingService: any = new AdminUsersService(failingDb, new QuotasService(failingDb));
    const logCount = await db.operationLog.count({ where: { targetId: rollbackUser.id } });
    for (const work of [() => failingService.update(rollbackUser.id, { account: `${prefix}-must-rollback`, reason }, admin), () => failingService.setPassword(rollbackUser.id, { password: newPassword, mustChangePassword: true, reason }, admin)]) {
      await assert.rejects(work(), /Fixture audit rollback/);
      const stored = await db.user.findUniqueOrThrow({ where: { id: rollbackUser.id } });
      assert.equal(stored.account, rollbackUser.account); assert.equal(stored.mustChangePassword, false);
      assert.ok(stored.passwordHash === rollbackUser.passwordHash, 'Original password hash must survive rollback');
      assert.equal((await strategy.validate(payload(rollbackSession.token))).id, rollbackUser.id);
      assert.equal(await db.operationLog.count({ where: { targetId: rollbackUser.id } }), logCount);
    }

    const logs = await db.operationLog.findMany({ where: { targetId: { in: ids }, actionType: { in: ['account_updated', 'admin_password_set', 'password_reset'] } } });
    assert.ok(logs.some(log => log.actionType === 'account_updated'));
    assert.ok(logs.some(log => log.actionType === 'password_reset'));
    const passwordLogs = logs.filter(log => log.actionType === 'admin_password_set'); assert.ok(passwordLogs.length >= 3);
    for (const log of passwordLogs) assert.deepEqual(Object.keys(log.afterValue as object), ['mustChangePassword']);
    const serialized = JSON.stringify(logs);
    for (const password of [oldPassword, newPassword, reset.initialPassword]) assert.ok(!serialized.includes(password), 'Audit must omit fixture passwords');
    assert.ok(!/passwordHash|password_hash|\$2[aby]\$\d{2}\$/.test(serialized), 'Audit must omit password hashes');
    const listed = await service.list({ search: newAccount, page: 1, pageSize: 20 });
    assert.ok(listed.items.some((user: any) => user.id === target.id));
  } finally {
    // Delete only records created by this test, never reset or truncate an existing database.
    try {
      await db.operationLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { targetId: { in: ids } }] } });
      await db.userSession.deleteMany({ where: { userId: { in: ids } } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
    } finally {
      await db.$disconnect();
      if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret;
    }
  }
});
