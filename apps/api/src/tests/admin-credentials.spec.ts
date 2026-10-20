import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AdminUsersService } from '../modules/admin/admin-users.service';
import { AdminGuard } from '../modules/admin/admin.controller';
import * as dtos from '../modules/admin/admin.dto';
import { validatePassword } from '../modules/auth/auth-security';
import { AuthService } from '../modules/auth/auth.service';

const assigned = 'Fixture8';
const reason = 'Fixture-only credential management';
const identity = (id: string, role = 'director') => ({ id, account: `fixture-${id}`, name: 'Fixture only', role, status: 'active', expiresAt: null as Date | null, passwordHash: 'fixture-unused-hash', mustChangePassword: false, managerId: null, department: null, createdById: null, lastLoginAt: null, createdAt: new Date() });
const admin = identity('admin', 'admin');
const input = (overrides: Record<string, unknown> = {}) => ({ account: 'Fixture User', name: 'Fixture only', role: 'director', initialPassword: assigned, reason, ...overrides });

function harness() {
  const state = { users: [structuredClone(admin), identity('target'), identity('other')], sessions: [{ userId: 'target', revokedAt: null as Date | null }, { userId: 'target', revokedAt: null as Date | null }, { userId: 'other', revokedAt: null as Date | null }], logs: [] as any[] };
  const calls = { updates: 0, revokes: 0, locks: [] as string[] };
  let failUnique = false, failAudit = false;
  const tx: any = {
    $executeRaw: async (sql: any) => { calls.locks.push(String(sql?.sql || sql)); return 1; },
    user: {
      findUnique: async ({ where }: any) => state.users.find(user => where.id ? user.id === where.id : user.account === where.account) || null,
      findFirst: async ({ where }: any) => state.users.find(user => user.account === where.account && user.id !== where.id?.not) || null,
      count: async ({ where }: any) => state.users.filter(user => user.id !== where.id?.not && user.role === 'admin' && user.status === 'active' && (!user.expiresAt || user.expiresAt > new Date())).length,
      create: async ({ data }: any) => {
        if (failUnique || state.users.some(user => user.account === data.account)) throw new Prisma.PrismaClientKnownRequestError('Fixture unique constraint', { code: 'P2002', clientVersion: 'fixture' });
        const user = { ...identity(`created-${state.users.length}`), ...data }; state.users.push(user); return user;
      },
      update: async ({ where, data }: any) => {
        if (failUnique || (data.account && state.users.some(user => user.id !== where.id && user.account === data.account))) throw new Prisma.PrismaClientKnownRequestError('Fixture unique constraint', { code: 'P2002', clientVersion: 'fixture' });
        const user = state.users.find(row => row.id === where.id); if (!user) throw new NotFoundException();
        calls.updates++; Object.assign(user, data); return user;
      },
    },
    userSession: { updateMany: async ({ where, data }: any) => { calls.revokes++; let count = 0; for (const session of state.sessions) if (session.userId === where.userId && session.revokedAt === null) { Object.assign(session, data); count++; } return { count }; } },
    operationLog: { create: async ({ data }: any) => { if (failAudit) throw Error('Fixture audit unavailable'); state.logs.push(data); return data; } },
    quotaPolicy: { findMany: async () => ['upload_count', 'storage_bytes', 'content_evaluations'].map(kind => ({ kind, limit: 10 })) },
  };
  const db: any = { ...tx, $transaction: async (work: any) => { const before = structuredClone(state); try { return await work(tx); } catch (error) { Object.assign(state, before); throw error; } } };
  const quotas: any = { lock: async (_tx: any, id: string) => { const user = state.users.find(row => row.id === id); if (!user) throw new NotFoundException('Fixture missing target'); return structuredClone(user); }, adjust: async () => ({}) };
  const service: any = new AdminUsersService(db, quotas);
  return { service, state, calls, unique: () => { failUnique = true; }, auditFailure: () => { failAudit = true; } };
}
const status = (expected: number) => (error: any) => error?.getStatus?.() === expected;
async function dto(name: string, value: unknown) {
  const type = (dtos as any)[name]; assert.equal(typeof type, 'function', `${name} must exist`);
  return new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }).transform(value, { type: 'body', metatype: type });
}
function noCredentialLeak(value: unknown, passwords: string[] = [assigned]) {
  const serialized = JSON.stringify(value);
  for (const password of passwords) assert.ok(!serialized.includes(password), 'Credential material must not be serialized');
  assert.ok(!/passwordHash|password_hash|\$2[aby]\$\d{2}\$/.test(serialized), 'Password hashes must not be serialized');
}

for (const account of ['中', '中文 账号 @业务!', 'Mixed.Case+运营', 'a', 'x'.repeat(100)]) {
  test(`create accepts printable Unicode account fixture (${account.length} characters)`, async () => {
    const h = harness(); const result = await h.service.create(await dto('CreateUserDto', input({ account })), admin);
    assert.equal(result.user.account, account); assert.equal(result.user.mustChangePassword, true);
    assert.ok(await bcrypt.compare(assigned, h.state.users.at(-1)!.passwordHash));
    assert.equal(bcrypt.getRounds(h.state.users.at(-1)!.passwordHash), 12);
    noCredentialLeak(result.user); noCredentialLeak(h.state.logs);
  });
}

for (const account of ['', '   ', 'x'.repeat(101), 'bad\u0000name', 'bad\nname', 'bad\tname', 'bad\u007fname', 'bad\u0085name', '\nValid fixture', 'Valid fixture\t', '\rValid fixture\n', 'bad\u202Ename', 'bad\u200Bname', '\uFEFFValid fixture']) {
  test(`invalid account fixture is rejected without writes (${JSON.stringify(account)})`, async () => {
    const h = harness();
    await assert.rejects(async () => h.service.create(await dto('CreateUserDto', input({ account })), admin), status(400));
    assert.equal(h.state.users.length, 3); assert.equal(h.state.logs.length, 0);
  });
}

test('create trims account without lowercasing and accepts an eight-character assigned password', async () => {
  const h = harness(); const result = await h.service.create(await dto('CreateUserDto', input({ account: '  中文 Mixed  ' })), admin);
  assert.equal(result.user.account, '中文 Mixed'); assert.equal(result.initialPassword, assigned);
});

for (const mustChangePassword of [true, false]) {
  test(`assigned creation preserves mustChangePassword=${mustChangePassword}`, async () => {
    const h = harness(); const result = await h.service.create(await dto('CreateUserDto', input({ mustChangePassword })), admin);
    assert.equal(result.user.mustChangePassword, mustChangePassword);
  });
  test(`random creation forces password change even when requested ${mustChangePassword}`, async () => {
    const h = harness(); const result = await h.service.create(await dto('CreateUserDto', input({ initialPassword: '', mustChangePassword })), admin);
    assert.ok(result.initialPassword.length >= 12); assert.ok(Buffer.byteLength(result.initialPassword) <= 72);
    assert.equal(result.user.mustChangePassword, true);
    assert.ok(await bcrypt.compare(result.initialPassword, h.state.users.at(-1)!.passwordHash));
    noCredentialLeak(h.state.logs, [result.initialPassword]);
  });
}

test('omitted initialPassword retains random generation and forced change', async () => {
  const h = harness(); const body = input(); delete (body as any).initialPassword;
  const result = await h.service.create(await dto('CreateUserDto', body), admin);
  assert.equal(result.user.mustChangePassword, true); assert.ok(result.initialPassword.length >= 12);
});

test('create duplicate account yields a safe 409 including database P2002', async () => {
  const h = harness(); h.unique();
  await assert.rejects(h.service.create(input(), admin), (error: any) => { assert.equal(error.getStatus(), 409); noCredentialLeak(error.getResponse()); assert.ok(!JSON.stringify(error.getResponse()).includes('P2002')); return true; });
  assert.equal(h.state.users.length, 3); assert.equal(h.state.logs.length, 0);
});

test('account update trims, audits account, and revokes every target session only', async () => {
  const h = harness(); const result = await h.service.update('target', await dto('UpdateUserDto', { account: '  新账号 Mixed  ', reason }), admin);
  assert.equal(result.user.account, '新账号 Mixed'); assert.ok(h.state.sessions.filter(s => s.userId === 'target').every(s => s.revokedAt));
  assert.equal(h.state.sessions.find(s => s.userId === 'other')!.revokedAt, null);
  assert.equal(h.state.logs.at(-1).actionType, 'account_updated'); assert.equal(h.state.logs.at(-1).afterValue.account, '新账号 Mixed');
  assert.ok(h.calls.locks.some(sql => sql.includes('701090702'))); noCredentialLeak(h.state.logs); noCredentialLeak(result);
});

test('unchanged trimmed account does not update or revoke sessions', async () => {
  const h = harness(); await h.service.update('target', { account: ' fixture-target ', reason }, admin);
  assert.equal(h.calls.updates, 0); assert.equal(h.calls.revokes, 0);
});

test('name and department updates retain sessions', async () => {
  const h = harness(); await h.service.update('target', { name: 'New display name', department: 'Fixture department', reason }, admin);
  assert.equal(h.calls.revokes, 0);
});

test('duplicate account update rolls back account, sessions and audit on P2002', async () => {
  const h = harness(); h.unique();
  await assert.rejects(h.service.update('target', { account: 'fixture-other', reason }, admin), ConflictException);
  assert.equal(h.state.users.find(u => u.id === 'target')!.account, 'fixture-target');
  assert.ok(h.state.sessions.every(s => s.revokedAt === null)); assert.equal(h.state.logs.length, 0);
});

for (const mustChangePassword of [true, false]) {
  test(`setPassword hashes at cost 12, sets flag ${mustChangePassword}, revokes sessions and safely audits`, async () => {
    const h = harness(); const result = await h.service.setPassword('target', { password: assigned, mustChangePassword, reason }, admin);
    assert.deepEqual(result, { success: true });
    const user = h.state.users.find(u => u.id === 'target')!;
    assert.equal(user.mustChangePassword, mustChangePassword); assert.ok(await bcrypt.compare(assigned, user.passwordHash)); assert.equal(bcrypt.getRounds(user.passwordHash), 12);
    assert.ok(h.state.sessions.filter(s => s.userId === 'target').every(s => s.revokedAt)); assert.equal(h.state.sessions.find(s => s.userId === 'other')!.revokedAt, null);
    assert.equal(h.state.logs.at(-1).actionType, 'admin_password_set'); assert.deepEqual(h.state.logs.at(-1).afterValue, { mustChangePassword });
    noCredentialLeak(h.state.logs); noCredentialLeak(result); assert.ok(h.calls.locks.some(sql => sql.includes('701090702')));
  });
}

for (const password of ['short77', 'x'.repeat(129), '密'.repeat(25), 'x'.repeat(73)]) {
  test(`setPassword rejects invalid fixture length/bytes (${password.length}/${Buffer.byteLength(password)})`, async () => {
    const h = harness(); await assert.rejects(h.service.setPassword('target', { password, mustChangePassword: false, reason }, admin), (error: any) => { assert.equal(error.getStatus(), 400); noCredentialLeak(error.getResponse(), [password]); return true; });
    assert.equal(h.calls.updates, 0); assert.equal(h.calls.revokes, 0); assert.equal(h.state.logs.length, 0);
  });
  test(`create rejects invalid assigned fixture length/bytes (${password.length}/${Buffer.byteLength(password)})`, async () => {
    const h = harness(); await assert.rejects(h.service.create(input({ initialPassword: password }), admin), BadRequestException);
    assert.equal(h.state.users.length, 3);
  });
}

test('setPassword accepts exactly 72 UTF-8 bytes and preserves password spaces', async () => {
  const h = harness(); const password = '密'.repeat(24);
  await h.service.setPassword('target', { password, mustChangePassword: false, reason }, admin);
  assert.ok(await bcrypt.compare(password, h.state.users.find(u => u.id === 'target')!.passwordHash));
  const spaced = ' Fixture8 ';
  await h.service.setPassword('target', { password: spaced, mustChangePassword: false, reason }, admin);
  assert.ok(await bcrypt.compare(spaced, h.state.users.find(u => u.id === 'target')!.passwordHash));
  assert.ok(!await bcrypt.compare(spaced.trim(), h.state.users.find(u => u.id === 'target')!.passwordHash));
});

test('SetPasswordDto requires boolean flag and bounded reason', async () => {
  for (const overrides of [{ mustChangePassword: undefined }, { mustChangePassword: 'false' }, { reason: '' }, { reason: 'x'.repeat(501) }, { password: null }]) {
    await assert.rejects(dto('SetPasswordDto', { password: assigned, mustChangePassword: false, reason, ...overrides }), BadRequestException);
  }
  const h = harness(); await assert.rejects(h.service.setPassword('target', { password: assigned, mustChangePassword: false, reason: '   ' }, admin), BadRequestException);
});

test('random reset remains one-time response, forced change and session revocation', async () => {
  const h = harness(); const result = await h.service.resetPassword('target', reason, admin);
  assert.deepEqual(Object.keys(result), ['initialPassword']); assert.ok(result.initialPassword.length >= 12);
  const user = h.state.users.find(u => u.id === 'target')!; assert.equal(user.mustChangePassword, true);
  assert.ok(await bcrypt.compare(result.initialPassword, user.passwordHash)); assert.ok(h.state.sessions.filter(s => s.userId === 'target').every(s => s.revokedAt));
  assert.equal(h.state.logs.at(-1).actionType, 'password_reset'); noCredentialLeak(h.state.logs, [result.initialPassword]);
});

for (const role of ['content_owner', 'supervisor', 'director', 'operator', 'advertiser', 'visitor']) {
  test(`${role} cannot create, rename or set another account password`, async () => {
    const h = harness(); h.state.users.find(u => u.id === 'other')!.role = role;
    const actor = { ...identity('other'), role };
    for (const work of [() => h.service.create(input(), actor), () => h.service.update('target', { account: 'Renamed fixture', reason }, actor), () => h.service.setPassword('target', { password: assigned, mustChangePassword: false, reason }, actor)]) await assert.rejects(work(), ForbiddenException);
    assert.equal(h.calls.updates, 0); assert.equal(h.state.logs.length, 0);
    assert.throws(() => new AdminGuard().canActivate({ switchToHttp: () => ({ getRequest: () => ({ user: actor }) }) } as any), ForbiddenException);
  });
}

test('archived same-account PATCH preserves ordinary profile updates', async () => {
  const h = harness(); const target = h.state.users.find(u => u.id === 'target')!;
  target.status = 'archived';
  const result = await h.service.update('target', { account: target.account, name: 'Archived fixture profile', reason }, admin);
  assert.equal(result.user.name, 'Archived fixture profile');
  assert.equal(result.user.account, target.account); assert.equal(result.user.status, 'archived');
  assert.ok(h.state.sessions.every(s => s.revokedAt === null));
  assert.equal(h.state.logs.length, 1);
});

test('archived changed-account PATCH is rejected without writes', async () => {
  const h = harness(); h.state.users.find(u => u.id === 'target')!.status = 'archived';
  await assert.rejects(h.service.update('target', { account: 'Archived renamed fixture', reason }, admin), ConflictException);
  assert.equal(h.calls.updates, 0); assert.equal(h.state.logs.length, 0);
});

test('archived random reset is rejected without writes', async () => {
  const h = harness(); h.state.users.find(u => u.id === 'target')!.status = 'archived';
  await assert.rejects(h.service.resetPassword('target', reason, admin), ConflictException);
  assert.equal(h.calls.updates, 0); assert.equal(h.state.logs.length, 0);
});

test('missing target is 404 and archived target cannot receive an assigned password', async () => {
  const h = harness(); await assert.rejects(h.service.setPassword('missing', { password: assigned, mustChangePassword: false, reason }, admin), NotFoundException);
  h.state.users.find(u => u.id === 'target')!.status = 'archived';
  await assert.rejects(h.service.setPassword('target', { password: assigned, mustChangePassword: false, reason }, admin), ConflictException);
  assert.equal(h.calls.updates, 0); assert.equal(h.state.logs.length, 0);
});

test('self credential changes revoke self sessions without removing the last active admin', async () => {
  const h = harness(); h.state.sessions.push({ userId: 'admin', revokedAt: null });
  await h.service.update('admin', { account: 'Admin 新账号', reason }, admin);
  await h.service.setPassword('admin', { password: assigned, mustChangePassword: false, reason }, admin);
  assert.ok(h.state.sessions.find(s => s.userId === 'admin')!.revokedAt); assert.equal(h.state.users.find(u => u.id === 'admin')!.role, 'admin');
  for (const changes of [{ role: 'director' }, { status: 'disabled' }, { expiresAt: new Date(0).toISOString() }]) await assert.rejects(h.service.update('admin', { ...changes, reason }, admin), ConflictException);
});

test('visitor credential changes retain expiry, role and quota policy', async () => {
  const h = harness(); const user = h.state.users.find(u => u.id === 'target')!; user.role = 'visitor'; user.expiresAt = new Date(Date.now() + 86400000) as any;
  const expiry = user.expiresAt;
  await h.service.update('target', { account: '访客 Fixture', reason }, admin);
  await h.service.setPassword('target', { password: assigned, mustChangePassword: false, reason }, admin);
  assert.equal(user.role, 'visitor'); assert.deepEqual(user.expiresAt, expiry);
});

test('audit failure rolls back password, account and session mutations', async () => {
  for (const operation of ['rename', 'password']) {
    const h = harness(); h.auditFailure();
    await assert.rejects(operation === 'rename' ? h.service.update('target', { account: 'New fixture', reason }, admin) : h.service.setPassword('target', { password: assigned, mustChangePassword: false, reason }, admin), /Fixture audit unavailable/);
    assert.equal(h.state.users.find(u => u.id === 'target')!.account, 'fixture-target');
    assert.ok(h.state.users.find(u => u.id === 'target')!.passwordHash === 'fixture-unused-hash', 'Original hash must be retained');
    assert.ok(h.state.sessions.every(s => s.revokedAt === null)); assert.equal(h.state.logs.length, 0);
  }
});

test('ordinary self-service password validation retains its 12-character floor and byte limit', () => {
  assert.throws(() => validatePassword(assigned), BadRequestException);
  assert.doesNotThrow(() => validatePassword('FixtureOnly-12'));
  assert.throws(() => validatePassword('密'.repeat(25)), BadRequestException);
});

test('login rejects old account when rename commits between initial lookup and locked reread', async () => {
  const password = 'FixtureOnly-Race-123';
  const original = { ...identity('fixture-user'), account: 'Old fixture account', passwordHash: await bcrypt.hash(password, 4) };
  let sessions = 0, signed = 0, updates = 0; const events: any[] = [];
  const tx: any = {
    $queryRaw: async () => [],
    user: { findUniqueOrThrow: async () => ({ ...original, account: 'New fixture account' }), update: async () => { updates++; return original; } },
    userSession: { create: async () => { sessions++; return { id: 'fixture-session' }; } },
    operationLog: { create: async ({ data }: any) => { events.push(data); return data; } },
  };
  const db: any = { user: { findUnique: async () => original }, operationLog: tx.operationLog, $transaction: async (work: any) => work(tx) };
  const service = new AuthService(db, { signAsync: async () => { signed++; return 'fixture-token'; } } as any);
  await assert.rejects(service.login({ account: original.account, password }, {}), UnauthorizedException);
  assert.equal(sessions, 0); assert.equal(signed, 0); assert.equal(updates, 0);
  assert.ok(events.some(event => event.actionType === 'login_failed'));
  assert.ok(!events.some(event => event.actionType === 'login_success'));
  noCredentialLeak(events, [password]);
});
