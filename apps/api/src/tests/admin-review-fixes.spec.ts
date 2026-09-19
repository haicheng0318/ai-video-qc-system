import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EvaluationWorker } from '../modules/evaluation-jobs/evaluation-worker';
import { AdminOperationsService, validateSetting } from '../modules/admin/admin-operations.service';
import { ForbiddenException } from '@nestjs/common';
import { firstValueFrom, throwError } from 'rxjs';

test('worker process heartbeat continues while long maintenance blocks claiming', async ctx => {
  ctx.mock.timers.enable({ apis: ['setInterval', 'Date'], now: new Date('2026-09-10T00:00:00Z') });
  let release!: () => void; let heartbeats = 0;
  const worker = new EvaluationWorker({ recordWorkerHeartbeat: async () => { heartbeats++; }, recoverExpired: async () => {}, recoverOrphans: async () => {}, claim: async () => null } as any, {} as any, {} as any, {} as any, { sweep: () => new Promise<void>(r => { release = r; }) } as any);
  const running = worker.runOnce(); await Promise.resolve(); await Promise.resolve();
  ctx.mock.timers.tick(125000); await Promise.resolve(); await Promise.resolve();
  assert.ok(heartbeats >= 2, 'maintenance must not stop process heartbeat');
  release(); await running;
});

test('legacy retry reconstructs only durable result/final foreign keys', async () => {
  for (const stage of ['result', 'final']) {
    let source: any;
    const service = new AdminOperationsService({ evaluationJob: { findUnique: async () => ({ id: 'job', videoId: 'video', status: 'needs_attention', stage, inputRefs: {}, resultReviewId: 'result-review', finalEvaluationId: 'final-review' }) }, aiResultReview: { findUnique: async () => ({ videoId: 'video', resultMetricId: 'original-metric' }) }, finalVideoEvaluation: { findUnique: async () => ({ videoId: 'video', ruleEngineResultId: 'original-rule' }) } } as any, { withAdminRetry: async (_o: any, _u: any, _r: any, callback: any) => callback() } as any, {} as any, { trigger: async (_v: any, dto: any) => { source = dto; } } as any, { trigger: async (_v: any, dto: any) => { source = dto; } } as any);
    await service.retry('job', { reason: 'recover', confirmed: true }, { id: 'admin' } as any);
    assert.deepEqual(source, stage === 'result' ? { resultMetricId: 'original-metric' } : { ruleEngineResultId: 'original-rule' });
  }
});

test('approved settings strictly accept bounded policy values and reject unsafe fields', () => {
  const cases = { site: { name: '内容质检', notice: '' }, visitor_defaults: { validDays: 7, uploadCount: 5, storageBytes: 1048576, contentEvaluations: 3 }, retention: { temporaryHours: 24, auditDays: 365 }, alerts: { workerStaleSeconds: 120, queueWaitSeconds: 600, expiryWarningDays: 7 }, video_options: { platforms: ['抖音'], videoTypes: ['product_card'] }, evaluation_parameters: { stage: 'result', modelName: 'qwen3.5-plus', maxOutputTokens: 4000 } };
  for (const [key, value] of Object.entries(cases)) { assert.deepEqual(validateSetting(key, value), value); assert.throws(() => validateSetting(key, { ...value, apiKey: 'no' })); }
});

test('transaction-time management identity denial is safely audited after entry guards', async () => {
  const path = '../modules/auth/management-denial.interceptor'; const { ManagementDenialInterceptor } = await import(path);
  const events: any[] = []; const interceptor = new ManagementDenialInterceptor({ create: async (event: any) => events.push(event) } as any);
  const request = { user: { id: 'user' }, path: '/api/admin/operations/settings/alerts', originalUrl: '/api/admin/operations/settings/alerts?SECRET', method: 'PUT', body: { secret: 'SECRET' } };
  const denied = new ForbiddenException('identity changed');
  await assert.rejects(firstValueFrom(interceptor.intercept({ switchToHttp: () => ({ getRequest: () => request }) } as any, { handle: () => throwError(() => denied) })), ForbiddenException);
  assert.equal(events.length, 1); assert.equal(events[0].actionType, 'management_access_denied'); assert.equal(JSON.stringify(events).includes('SECRET'), false);
});
