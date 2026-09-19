import 'reflect-metadata';
import assert from 'node:assert/strict';
import { assertIsolatedDatabase } from '../test-support/local-acceptance';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const url = process.env.IDENTITY_TEST_DATABASE_URL;
test('atomic quota ledger rejects concurrent overspend, changed-key amounts, double refunds and rolls back', { skip: !url }, async () => {
  assertIsolatedDatabase(url);
  const modulePath = '../modules/quotas/quotas.service';
  const mod = await import(modulePath).catch(() => ({}));
  assert.equal(typeof mod.QuotasService, 'function', 'atomic quota service must exist');
  const db = new PrismaClient({ datasourceUrl: url });
  const quotas = new mod.QuotasService(db);
  const user = await db.user.create({ data: { account: randomUUID(), name: 'Quota test', role: 'director', passwordHash: 'unused' } });
  const run = (fn: (tx: any) => any) => db.$transaction(fn, { timeout: 15000 });
  try {
    await run((tx) => quotas.adjust(tx, user.id, { kind: 'upload_count', period: 'daily', limit: 1, reason: 'test limit', businessKey: randomUUID() }, user.id));
    const results = await Promise.allSettled(['a', 'b'].map((key) => run((tx) => quotas.reserve(tx, user.id, 'upload_count', 1, key))));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const key = results[0].status === 'fulfilled' ? 'a' : 'b';
    const original: any = await run((tx) => quotas.reserve(tx, user.id, 'upload_count', 1, key));
    const duplicate: any = await run((tx) => quotas.reserve(tx, user.id, 'upload_count', 1, key));
    assert.equal(original.id, duplicate.id);
    await assert.rejects(run((tx) => quotas.reserve(tx, user.id, 'upload_count', 2, key)), /business key/i);
    await run((tx) => quotas.release(tx, user.id, 'upload_count', key));
    await run((tx) => quotas.release(tx, user.id, 'upload_count', key));
    assert.equal((await quotas.summary(user.id)).quotas.find((q: any) => q.kind === 'upload_count').reserved, 0);
    await assert.rejects(run(async (tx) => { await quotas.reserve(tx, user.id, 'upload_count', 1, 'rollback'); throw Error('rollback'); }), /rollback/);
    await run(async (tx) => { await quotas.reserve(tx, user.id, 'upload_count', 1, 'commit'); await quotas.commit(tx, user.id, 'upload_count', 'commit'); });
    const summary = await quotas.summary(user.id);
    const count = summary.quotas.find((q: any) => q.kind === 'upload_count');
    assert.equal(count.used, 1); assert.equal(count.reserved, 0); assert.equal(count.remaining, 0);
    assert.equal(summary.quotas.find((q: any) => q.kind === 'storage_bytes').limit, null);
    await assert.rejects(run((tx) => quotas.reserve(tx, user.id, 'upload_count', 1, 'over')), /quota/i);
    assert.deepEqual(mod.quotaWindow('daily', new Date('2026-09-07T16:01:00Z')), { start: new Date('2026-09-07T16:00:00Z'), end: new Date('2026-09-08T16:00:00Z') });
    assert.deepEqual(mod.quotaWindow('monthly', new Date('2026-01-31T16:01:00Z')), { start: new Date('2026-01-31T16:00:00Z'), end: new Date('2026-02-28T16:00:00Z') });
  } finally { await db.$disconnect(); }
});
