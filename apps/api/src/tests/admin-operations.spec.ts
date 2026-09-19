import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { AdminGuard } from '../modules/admin/admin.controller';

async function implementation() {
  const path = '../modules/admin/admin-operations.service';
  const loaded = await import(path).catch(() => ({}));
  assert.equal(typeof loaded.AdminOperationsService, 'function', 'management runtime service must exist');
  return loaded;
}

test('every nonadministrator is denied access to the operations boundary', () => {
  for (const role of ['content_owner', 'supervisor', 'director', 'operator', 'advertiser', 'visitor', undefined]) {
    assert.throws(() => new AdminGuard().canActivate({ switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }) } as any));
  }
});

test('job and attempt projections exclude lease credentials, source payloads and stack errors', async () => {
  const { safeJob, safeAttempt } = await implementation();
  const unsafe = { id: 'j', stage: 'content', status: 'failed', attempts: 2, actorId: 'u', inputRefs: { secret: 'secret' }, leaseToken: 'secret', workerId: 'secret', rawResponse: 'secret', failureCode: 'secret stack' };
  assert.equal(JSON.stringify(safeJob(unsafe)).includes('secret'), false);
  assert.equal(JSON.stringify(safeAttempt(unsafe)).includes('secret'), false);
});

test('usage aggregation keeps missing observations and currency categories separate', async () => {
  const { summarizeUsage } = await implementation();
  const result = summarizeUsage([
    { stage: 'content', provider: 'aliyun_bailian', modelName: 'qwen', status: 'succeeded', inputTokens: 100, outputTokens: 20, estimatedCost: '0.12', actualCost: null, currency: 'CNY' },
    { stage: 'content', provider: 'aliyun_bailian', modelName: 'qwen', status: 'uncertain', inputTokens: null, outputTokens: null, estimatedCost: null, actualCost: null, currency: 'CNY' },
    { stage: 'result', provider: 'aliyun_bailian', modelName: 'qwen', status: 'succeeded', inputTokens: 0, outputTokens: 0, estimatedCost: '0', actualCost: '0.2', currency: 'USD' },
  ]);
  assert.equal(result.calls, 3); assert.equal(result.unknownUsageCalls, 1);
  assert.equal(result.billingStatus, 'not_connected');
  assert.equal(result.groups.length, 2);
  assert.equal(result.groups[0].actualCost, null); assert.equal(result.groups[0].estimatedCost, '0.12');
  assert.equal(result.groups[0].estimateCoverage, 'partial');
});

test('settings reject unknown keys, credentials and invalid price or version values', async () => {
  const { validateSetting } = await implementation();
  for (const [key, value] of [['API_KEY', 'secret'], ['cost_rates', { model: 'bad' }], ['console_notice', '<script>']]) assert.throws(() => validateSetting(key, value));
  assert.deepEqual(validateSetting('cost_rates', { provider: 'aliyun_bailian', modelName: 'qwen', currency: 'CNY', inputPerMillion: 2, outputPerMillion: 8 }), { provider: 'aliyun_bailian', modelName: 'qwen', currency: 'CNY', inputPerMillion: 2, outputPerMillion: 8 });
});

test('readiness fails for database failure without exposing internal exception text', async () => {
  const { AdminOperationsService } = await implementation();
  const service = new AdminOperationsService({ $queryRaw: async () => { throw new Error('secret host password'); } });
  assert.deepEqual(await service.readiness(), { status: 'not_ready', database: 'unavailable' });
});

test('export is bounded, audited, and neutralizes spreadsheet formulas', async () => {
  const { csvCell, AdminOperationsService } = await implementation();
  assert.equal(csvCell('=HYPERLINK("secret")'), '"\'=HYPERLINK(""secret"")"');
  const service = new AdminOperationsService({});
  await assert.rejects(service.exportUsage({}, { reason: '', confirmed: false }, { id: 'u' }));
});

test('retry rejects missing confirmation before calling stage triggers', async () => {
  const { AdminOperationsService } = await implementation();
  const service = new AdminOperationsService({});
  await assert.rejects(service.retry('j', { reason: ' ', confirmed: true }, { id: 'u' }));
  await assert.rejects(service.retry('j', { reason: 'retry', confirmed: false }, { id: 'u' }));
});
