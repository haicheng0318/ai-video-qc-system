import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, UserRole, VideoType } from '@prisma/client';
import { PlatformBenchmarksService } from '../modules/platform-benchmarks/platform-benchmarks.service';

const actor = {
  id: '00000000-0000-4000-8000-000000000801',
  account: 'admin', name: 'Admin', role: UserRole.admin, managerId: null,
};
const input = {
  platform: '抖音', brand: null, videoType: VideoType.product_card,
  metricName: 'roi', sThreshold: 3, aThreshold: 2.5, bThreshold: 2, cThreshold: 1,
  direction: 'higher_is_better' as const, enabled: true,
};

function harness() {
  const records: Array<Record<string, any>> = [];
  const logs: Array<Record<string, any>> = [];
  const revisions: Array<Record<string, any>> = [];
  const client = {
    user: { findUnique: async () => ({ ...actor, status: 'active', mustChangePassword: false }) },
    $queryRaw: async () => [],
    configurationRevision: { findFirst: async () => revisions.at(-1) || null, create: async ({ data }: any) => { revisions.push(data); return data; } },
    platformBenchmark: {
      findMany: async () => records,
      findUnique: async ({ where }: any) => records.find((item) => item.id === where.id) || null,
      findFirst: async ({ where }: any) => records.find((item) =>
        item.platform === where.platform && item.brand === where.brand &&
        item.videoType === where.videoType && item.metricName === where.metricName &&
        (!where.id?.not || item.id !== where.id.not)) || null,
      create: async ({ data }: any) => {
        const now = new Date('2026-08-27T00:00:00.000Z');
        const created = { id: `00000000-0000-4000-8000-${String(records.length + 1).padStart(12, '0')}`, ...data, createdAt: now, updatedAt: now };
        records.push(created);
        return created;
      },
      update: async ({ where, data }: any) => {
        const index = records.findIndex((item) => item.id === where.id);
        records[index] = { ...records[index], ...data, updatedAt: new Date('2026-08-27T01:00:00.000Z') };
        return records[index];
      },
    },
  };
  const prisma = {
    ...client,
    $transaction: async (callback: (transaction: any) => Promise<any>) => callback(client),
  };
  const service = new PlatformBenchmarksService(prisma as never, {
    create: async (entry: Record<string, any>) => { logs.push(entry); },
  } as never);
  return { service, records, logs, revisions };
}

test('benchmark mutation revalidates current administrator before writing', async () => {
  let writes = 0;
  const tx = { $queryRaw: async () => [], user: { findUnique: async () => ({ ...actor, role: 'content_owner', status: 'active' }) }, platformBenchmark: { findFirst: async () => null, create: async () => { writes++; return {}; } }, configurationRevision: { create: async () => ({}) } };
  const service = new PlatformBenchmarksService({ $transaction: async (fn: any) => fn(tx) } as any, { create: async () => {} } as any);
  await assert.rejects(service.create(input, actor, {}), /Administrator/);
  assert.equal(writes, 0);
});

test('benchmark edits append immutable versions without rewriting earlier thresholds', async () => {
  const state = harness();
  const created = await state.service.create(input, actor, {});
  await state.service.replace(created.id, { ...input, sThreshold: 4 }, actor, {});
  assert.equal(state.revisions.length, 2);
  assert.equal(state.revisions[0].value.sThreshold, '3');
  assert.equal(state.revisions[1].value.sThreshold, '4');
  assert.equal(state.revisions[1].version, 2);
});

test('platform benchmark create persists thresholds and an audit log', async () => {
  const state = harness();
  const result = await state.service.create(input, actor, {});
  assert.equal(result.metricName, 'roi');
  assert.equal(result.sThreshold, '3');
  assert.equal(state.records[0].sThreshold instanceof Prisma.Decimal, true);
  assert.equal(state.logs[0].actionType, 'platform_benchmark_created');
});

test('platform benchmark rejects an unsupported metric', async () => {
  await assert.rejects(
    harness().service.create({ ...input, metricName: 'unknown_metric' }, actor, {}),
    BadRequestException,
  );
});

test('higher-is-better benchmark enforces S >= A >= B >= C', async () => {
  await assert.rejects(
    harness().service.create({ ...input, sThreshold: 1, aThreshold: 2 }, actor, {}),
    /S ≥ A ≥ B ≥ C/,
  );
});

test('duplicate platform, brand, video type and metric is rejected', async () => {
  const state = harness();
  await state.service.create(input, actor, {});
  await assert.rejects(state.service.create(input, actor, {}), ConflictException);
});

test('platform benchmark full replacement supports disabling and logs before/after', async () => {
  const state = harness();
  const created = await state.service.create(input, actor, {});
  const updated = await state.service.replace(created.id, { ...input, enabled: false }, actor, {});
  assert.equal(updated.enabled, false);
  assert.equal(state.logs.at(-1)?.actionType, 'platform_benchmark_updated');
  assert.equal(state.logs.at(-1)?.beforeValue.enabled, true);
  assert.equal(state.logs.at(-1)?.afterValue.enabled, false);
});
