import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UserRole } from '@prisma/client';
import { DashboardService } from '../modules/dashboard/dashboard.service';

const user = (role: UserRole) => ({ id: '123e4567-e89b-42d3-a456-426614174000', role, account: role, name: role, managerId: null });

function sqlText(query: any) { return query.strings.join('?'); }

test('summary maps aggregate counts and null-safe rates', async () => {
  const calls: any[] = [];
  const service = new DashboardService({ $queryRaw: async (query: any) => {
    calls.push(query);
    return sqlText(query).includes('FROM final_video_evaluations') ? [{
      finalized: 10n, effective: 4n, low_effective: 3n, invalid: 3n, effective_output: 7n,
      performance_eligible: 5n, excellent_cases: 2n, negative_cases: 1n, gpt_matched: 8n, manually_adjusted: 2n,
    }] : [{ pending_data: 1n, pending_final_evaluation: 2n, final_evaluation_failed: 3n, pending_final_confirmation: 4n }];
  } } as any);
  const result = await service.summary({}, user(UserRole.admin));
  assert.equal(result.finalizedCount, 10); assert.equal(result.finalEffectiveRate, 40); assert.equal(result.effectiveOutputRate, 70);
  assert.equal(result.lowEffectiveRate, 30); assert.equal(result.gptMatchRate, 80); assert.equal(result.manualAdjustmentRate, 20);
  assert.equal(result.pipeline.pendingFinalConfirmationCount, 4); assert.equal(calls.length, 2);
});

test('zero finalized denominator returns null rates', async () => {
  const service = new DashboardService({ $queryRaw: async (query: any) => sqlText(query).includes('FROM final_video_evaluations') ? [{}] : [{}] } as any);
  const result = await service.summary({}, user(UserRole.admin));
  assert.equal(result.finalEffectiveRate, null); assert.equal(result.invalidRate, null); assert.equal(result.gptMatchRate, null);
});

for (const role of Object.values(UserRole)) {
  test(`${role} dashboard visibility is applied inside SQL`, async () => {
    const calls: any[] = [];
    const service = new DashboardService({ $queryRaw: async (query: any) => { calls.push(query); return [{}]; } } as any);
    await service.summary({}, user(role));
    const query = sqlText(calls[0]);
    if (role === UserRole.supervisor) assert.match(query, /manager_id/);
    else if (role === UserRole.director) assert.match(query, /creator_id/);
    else assert.doesNotMatch(query, /manager_id/);
  });
}

for (const granularity of ['day', 'week'] as const) {
  test(`${granularity} trend groups confirmed records in SQL`, async () => {
    const calls: any[] = [];
    const service = new DashboardService({ $queryRaw: async (query: any) => { calls.push(query); return [{ bucket: new Date('2026-08-01'), finalized: 2n, effective: 1n, low_effective: 0n, invalid: 1n }]; } } as any);
    const result = await service.trend({ granularity }, user(UserRole.admin));
    assert.match(sqlText(calls[0]), new RegExp(`date_trunc\\('${granularity}'`)); assert.equal(result.items[0].finalizedCount, 2);
    assert.equal(result.items[0].effectiveOutputRate, 50);
  });
}

for (const groupBy of ['brand', 'platform', 'videoType', 'creator'] as const) {
  test(`${groupBy} breakdown uses a whitelisted SQL expression`, async () => {
    const calls: any[] = [];
    const service = new DashboardService({ $queryRaw: async (query: any) => { calls.push(query); return [{ group_key: 'key', group_label: 'Group', finalized: 4n, effective: 2n, low_effective: 1n, invalid: 1n, performance_eligible: 2n, excellent_cases: 1n, negative_cases: 0n, manually_adjusted: 1n }]; } } as any);
    const result = await service.breakdown({ groupBy }, user(UserRole.admin));
    assert.equal(result.items[0].effectiveOutputRate, 75); assert.equal(result.items[0].groupKey, 'key'); assert.match(sqlText(calls[0]), /GROUP BY 1, 2/);
  });
}

for (const filter of ['brand', 'platform', 'videoType', 'creatorId'] as const) {
  test(`${filter} is parameterized in dashboard query`, async () => {
    const calls: any[] = [];
    const service = new DashboardService({ $queryRaw: async (query: any) => { calls.push(query); return [{}]; } } as any);
    const values: any = { brand: 'Brand', platform: 'douyin', videoType: 'organic', creatorId: '123e4567-e89b-42d3-a456-426614174000' };
    await service.summary({ [filter]: values[filter] }, user(UserRole.admin));
    assert.ok(calls[0].values.includes(values[filter]));
    assert.equal(sqlText(calls[0]).includes(values[filter]), false);
  });
}

test('dashboard rejects an inverted date period', async () => {
  const service = new DashboardService({} as any);
  await assert.rejects(service.summary({ startDate: '2026-08-08', endDate: '2026-08-01' }, user(UserRole.admin)));
});

test('summary query only counts confirmed formal evaluations', async () => {
  const calls: any[] = [];
  const service = new DashboardService({ $queryRaw: async (query: any) => { calls.push(query); return [{}]; } } as any);
  await service.summary({}, user(UserRole.admin));
  assert.match(sqlText(calls.find((query) => sqlText(query).includes('final_video_evaluations'))), /confirmed_at BETWEEN/);
  assert.match(sqlText(calls.find((query) => sqlText(query).includes('final_video_evaluations'))), /final_grade IS NOT NULL/);
});

test('pipeline query is separate from finalized denominator', async () => {
  const calls: any[] = [];
  const service = new DashboardService({ $queryRaw: async (query: any) => { calls.push(query); return [{}]; } } as any);
  await service.summary({}, user(UserRole.admin));
  assert.equal(calls.filter((query) => sqlText(query).includes('FROM videos v')).length, 1);
});
