import { ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { EvaluationJob, Prisma, VideoStatus } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuotasService, assertIdentityActive } from '../quotas/quotas.service';

export type JobStage = 'content' | 'result' | 'final';
export type EvaluationLease = { job: EvaluationJob; token: string };
export type JobInput = {
  videoId: string; actorId: string; stage: JobStage;
  contentReviewId?: string; resultReviewId?: string; finalEvaluationId?: string;
  inputRefs?: Record<string, string | null>; maxOutputTokens?: number;
};
export class EvaluationLeaseLostError extends Error {
  constructor() { super('Evaluation lease or source binding is no longer valid.'); }
}

function evaluationErrorChain(error: unknown) {
  const chain: any[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === 'object' && chain.length < 6 && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = (current as any).cause;
  }
  return chain;
}

export function classifyEvaluationError(error: any): string {
  const chain = evaluationErrorChain(error);
  const codes = chain.map(item => String(item?.code || ''));
  const names = chain.map(item => String(item?.name || ''));
  const statuses = chain.map(item => item?.status);
  const code = codes[0] || '';
  if (statuses.includes(429)) return 'rate_limit';
  if (statuses.includes(401) || statuses.includes(403) || codes.some(value => value.includes('NOT_CONFIGURED'))) return 'configuration';
  if (codes.some(value => value === 'ETIMEDOUT' || value.includes('TIMEOUT')) || names.some(value => value.includes('Timeout'))) return 'timeout';
  if (code.includes('OUTPUT_INVALID')) return 'parsing';
  if (code.includes('SOURCE') || code.includes('BINDING') || error instanceof EvaluationLeaseLostError) return 'source_changed';
  if (code.includes('FILE_PROCESSING')) return 'storage';
  if (code.includes('REFUSED')) return 'refusal';
  return 'provider_or_execution';
}
const active = ['queued', 'running', 'retry_wait'];
const expectedStatus: Record<string, VideoStatus> = {
  content: VideoStatus.ai_content_reviewing, result: VideoStatus.ai_result_reviewing,
  final: VideoStatus.pending_final_evaluation,
};
const failedStatus: Record<string, VideoStatus> = {
  content: VideoStatus.ai_content_failed, result: VideoStatus.ai_result_failed,
  final: VideoStatus.final_evaluation_failed,
};

@Injectable()
export class EvaluationJobsService {
  private readonly context = new AsyncLocalStorage<EvaluationLease>();
  private readonly retryContext = new AsyncLocalStorage<{ old: EvaluationJob; actorId: string; reason: string }>();
  constructor(private readonly prisma: PrismaService, private readonly permissions: PermissionsService, @Optional() private readonly quotas?: QuotasService) {}

  // All paths acquire video before job. Capacity lock is taken only by claim/recovery,
  // never by result writers, so a writer cannot form a lock cycle with a claimant.
  async enqueue(tx: Prisma.TransactionClient, input: JobInput, legacy = false) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${input.videoId}::uuid FOR UPDATE`);
    const retry = this.retryContext.getStore();
    if (retry) {
      const original = await tx.evaluationJob.findUnique({ where: { id: retry.old.id } });
      const latest = await tx.evaluationJob.findFirst({ where: { videoId: input.videoId, stage: input.stage }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      if (!original || original.videoId !== input.videoId || original.stage !== input.stage || !['failed', 'needs_attention'].includes(original.status) || latest?.id !== original.id || await tx.evaluationJob.findFirst({ where: { retriedFromId: original.id } })) throw new ConflictException('Task was already retried or superseded.');
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id IN (${retry.actorId}::uuid, ${original.actorId}::uuid) ORDER BY id FOR UPDATE`);
      const administrator = await tx.user.findUnique({ where: { id: retry.actorId } });
      if (!administrator || administrator.role !== 'admin' || administrator.status !== 'active' || administrator.mustChangePassword || (administrator.expiresAt && +administrator.expiresAt <= Date.now())) throw new ForbiddenException('Administrator is no longer active.');
      input = { ...input, actorId: original.actorId };
      if (this.quotas) assertIdentityActive(await this.quotas.lock(tx, original.actorId));
    }
    await this.assertNoActive(tx, input.videoId, input.stage);
    const allowedRefs = ['resultMetricId', 'contentReviewId', 'supervisorReviewId', 'benchmarkSnapshotId', 'resultReviewId', 'ruleEngineResultId'];
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const [key, value] of Object.entries(input.inputRefs || {})) {
      if (!allowedRefs.includes(key) || (value !== null && (Array.isArray(value) || !uuid.test(value)))) {
        throw new ConflictException('Only durable database source references may be queued.');
      }
    }
    const target = input.stage === 'content' && input.contentReviewId ? await tx.aiContentReview.findUnique({ where: { id: input.contentReviewId } })
      : input.stage === 'result' && input.resultReviewId ? await tx.aiResultReview.findUnique({ where: { id: input.resultReviewId } })
        : input.stage === 'final' && input.finalEvaluationId ? await tx.finalVideoEvaluation.findUnique({ where: { id: input.finalEvaluationId } }) : null;
    if (!target || target.videoId !== input.videoId || target.status !== 'running') throw new EvaluationLeaseLostError();
    const job = await tx.evaluationJob.create({ data: { ...input, inputRefs: input.inputRefs || {}, ...(retry ? { retriedFromId: retry.old.id } : {}) } });
    if (retry) await tx.operationLog.create({ data: { userId: retry.actorId, videoId: input.videoId, actionType: 'admin_evaluation_retry', targetType: 'evaluation_job', targetId: job.id, result: 'success', comment: retry.reason, afterValue: { originalJobId: retry.old.id, newJobId: job.id, stage: input.stage, quotaUserId: input.actorId } } });
    if (input.stage === 'content' && !legacy) await this.quotas?.reserve(tx, input.actorId, 'content_evaluations', 1, `content:${job.id}`);
    // Use database time for scheduling: separate worker/API hosts can have clock skew.
    await tx.$executeRaw(Prisma.sql`UPDATE evaluation_jobs SET available_at = clock_timestamp() WHERE id = ${job.id}::uuid`);
    return job;
  }

  async assertNoActive(tx: Prisma.TransactionClient, videoId: string, stage: JobStage) {
    if (await tx.evaluationJob.findFirst({ where: { videoId, stage, status: { in: active } } })) {
      throw new ConflictException('An evaluation job is already active for this video and stage.');
    }
  }

  private leaseMilliseconds() {
    const value = Number(process.env.EVALUATION_JOB_LEASE_MS || 90000);
    return Number.isInteger(value) && value >= 15000 && value <= 600000 ? value : 90000;
  }

  async claim(workerId: string): Promise<EvaluationLease | null> {
    return this.prisma.$transaction(async (tx) => {
      const locks = await tx.$queryRaw<Array<{ acquired: boolean }>>(Prisma.sql`SELECT pg_try_advisory_xact_lock(701090701) AS acquired`);
      if (!locks[0]?.acquired) return null;
      // Initial global concurrency is deliberately one, including expired leases until recovered.
      if (await tx.evaluationJob.count({ where: { status: 'running' } })) return null;
      const candidates = await tx.$queryRaw<Array<{ id: string; video_id: string }>>(Prisma.sql`
        SELECT j.id, j.video_id FROM evaluation_jobs j JOIN videos v ON v.id = j.video_id
        WHERE j.status IN ('queued', 'retry_wait') AND j.available_at <= clock_timestamp()
        ORDER BY j.available_at, j.created_at, j.id LIMIT 1 FOR UPDATE OF v SKIP LOCKED`);
      if (!candidates[0]) return null;
      const id = candidates[0].id;
      await tx.$queryRaw(Prisma.sql`SELECT id FROM evaluation_jobs WHERE id = ${id}::uuid FOR UPDATE`);
      const job = await tx.evaluationJob.findUniqueOrThrow({ where: { id } });
      if (!['queued', 'retry_wait'].includes(job.status)) return null;
      const token = randomUUID();
      await tx.$executeRaw(Prisma.sql`UPDATE evaluation_jobs SET status = 'running', attempts = attempts + 1,
        lease_token = ${token}::uuid, worker_id = ${workerId}, external_started_at = NULL,
        lease_expires_at = clock_timestamp() + ${this.leaseMilliseconds()} * interval '1 millisecond', updated_at = clock_timestamp()
        WHERE id = ${id}::uuid`);
      const claimed = await tx.evaluationJob.findUniqueOrThrow({ where: { id } });
      await tx.evaluationJobAttempt.create({ data: {
        jobId: id, attemptNumber: claimed.attempts, fencingToken: token, workerId, status: 'running',
      } });
      return { job: claimed, token };
    });
  }

  runWithLease<T>(lease: EvaluationLease, action: () => Promise<T>): Promise<T> {
    return this.context.run(lease, action);
  }

  withAdminRetry<T>(old: EvaluationJob, actorId: string, reason: string, action: () => Promise<T>) {
    return this.retryContext.run({ old, actorId, reason }, action);
  }

  async recordWorkerHeartbeat(workerId: string) {
    await this.prisma.workerHeartbeat.upsert({ where: { id: workerId }, create: { id: workerId }, update: { lastSeenAt: new Date() } });
  }

  async recordTemporaryStorage(objectPath: string, status: 'uploading' | 'uploaded' | 'cleaned' | 'cleanup_failed') {
    const lease = this.context.getStore();
    await this.prisma.temporaryStorageRecord.upsert({ where: { objectPath }, create: { objectPath, provider: 'oss', status, jobId: lease?.job.id }, update: { status } });
  }

  async recordUsage(usage: { inputTokens?: number; outputTokens?: number } | undefined, usageAvailable = true) {
    const lease = this.context.getStore();
    if (!lease) return;
    const attempt = await this.prisma.evaluationJobAttempt.findUnique({ where: { fencingToken: lease.token }, select: { id: true } });
    if (!attempt) return;
    const record = await this.prisma.aiUsageRecord.findUnique({ where: { attemptId: attempt.id } });
    if (!record) return;
    const valid = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= 2147483647;
    const inputTokens = usageAvailable && valid(usage?.inputTokens) ? usage!.inputTokens! : null;
    const outputTokens = usageAvailable && valid(usage?.outputTokens) ? usage!.outputTokens! : null;
    const rate = record.rateSnapshot as { inputPerMillion: number; outputPerMillion: number } | null;
    const estimatedCost = rate && inputTokens !== null && outputTokens !== null ? new Prisma.Decimal(inputTokens).mul(rate.inputPerMillion).add(new Prisma.Decimal(outputTokens).mul(rate.outputPerMillion)).div(1000000) : null;
    await this.prisma.aiUsageRecord.update({ where: { id: record.id }, data: { inputTokens, outputTokens, estimatedCost, collectionStatus: inputTokens !== null && outputTokens !== null ? 'collected' : 'unknown' } });
  }
  async recordCollectionFailure() {
    const lease = this.context.getStore();
    if (lease) await this.prisma.aiUsageRecord.updateMany({ where: { attempt: { fencingToken: lease.token } }, data: { collectionStatus: 'failed' } });
  }

  async assertLease(tx: Prisma.TransactionClient, lease: EvaluationLease) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${lease.job.videoId}::uuid FOR UPDATE`);
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM evaluation_jobs
      WHERE id = ${lease.job.id}::uuid AND status = 'running' AND lease_token = ${lease.token}::uuid
      AND lease_expires_at > clock_timestamp() FOR UPDATE`);
    if (!rows.length) throw new EvaluationLeaseLostError();
  }

  async assertCurrent(tx: Prisma.TransactionClient, videoId: string, targetId: string) {
    const lease = this.context.getStore();
    if (!lease) throw new EvaluationLeaseLostError();
    const job = lease.job;
    if (videoId !== job.videoId || targetId !== (job.contentReviewId || job.resultReviewId || job.finalEvaluationId)) throw new EvaluationLeaseLostError();
    await this.assertLease(tx, lease);
    const video = await tx.video.findUnique({ where: { id: videoId } });
    if (video?.status !== expectedStatus[job.stage]) throw new EvaluationLeaseLostError();
    const refs = job.inputRefs as Record<string, unknown>;
    if (job.stage === 'content') {
      const review = await tx.aiContentReview.findUnique({ where: { id: targetId } });
      if (review?.videoId !== videoId || review.status !== 'running') throw new EvaluationLeaseLostError();
    } else if (job.stage === 'result') {
      const review = await tx.aiResultReview.findUnique({ where: { id: targetId } });
      const latest = await tx.videoResultMetric.findFirst({ where: { videoId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      if (review?.videoId !== videoId || review.status !== 'running' || review.resultMetricId !== refs.resultMetricId || latest?.id !== refs.resultMetricId) throw new EvaluationLeaseLostError();
      const snapshot = typeof refs.benchmarkSnapshotId === 'string' ? await tx.evaluationInputSnapshot.findUnique({ where: { id: refs.benchmarkSnapshotId } }) : null;
      if (snapshot?.videoId !== videoId) throw new EvaluationLeaseLostError();
    } else {
      const evaluation = await tx.finalVideoEvaluation.findUnique({ where: { id: targetId } });
      if (evaluation?.videoId !== videoId || evaluation.status !== 'running' || evaluation.contentReviewId !== refs.contentReviewId ||
        evaluation.resultReviewId !== refs.resultReviewId || evaluation.ruleEngineResultId !== refs.ruleEngineResultId) throw new EvaluationLeaseLostError();
    }
  }

  async heartbeat(lease: EvaluationLease) {
    const count = await this.prisma.$executeRaw(Prisma.sql`UPDATE evaluation_jobs
      SET lease_expires_at = clock_timestamp() + ${this.leaseMilliseconds()} * interval '1 millisecond', updated_at = clock_timestamp()
      WHERE id = ${lease.job.id}::uuid AND status = 'running' AND lease_token = ${lease.token}::uuid
      AND lease_expires_at > clock_timestamp()`);
    return count === 1;
  }

  async markExternalStarted() {
    const lease = this.context.getStore();
    if (!lease) throw new EvaluationLeaseLostError();
    await this.prisma.$transaction(async (tx) => {
      await this.assertCurrent(tx, lease.job.videoId, (lease.job.contentReviewId || lease.job.resultReviewId || lease.job.finalEvaluationId)!);
      // Serialize the last eligibility check with account disable/expiry changes.
      if (this.quotas) {
        const actor = await this.quotas.lock(tx, lease.job.actorId);
        assertIdentityActive(actor);
        if (actor.role === 'visitor' && (lease.job.stage !== 'content' || (await tx.video.findUnique({ where: { id: lease.job.videoId } }))?.creatorId !== actor.id)) throw new ForbiddenException('Visitor cannot execute this evaluation.');
      }
      await tx.evaluationJob.update({ where: { id: lease.job.id }, data: { externalStartedAt: new Date() } });
      await tx.evaluationJobAttempt.update({ where: { fencingToken: lease.token }, data: { externalStartedAt: new Date() } });
      const attempt = await tx.evaluationJobAttempt.findUniqueOrThrow({ where: { fencingToken: lease.token } });
      const review = lease.job.contentReviewId ? await tx.aiContentReview.findUniqueOrThrow({ where: { id: lease.job.contentReviewId } }) : lease.job.resultReviewId ? await tx.aiResultReview.findUniqueOrThrow({ where: { id: lease.job.resultReviewId } }) : await tx.finalVideoEvaluation.findUniqueOrThrow({ where: { id: lease.job.finalEvaluationId! } });
      const setting = await tx.runtimeSetting.findUnique({ where: { key: 'cost_rates' } });
      const rate = setting?.value as Record<string, any> | undefined;
      const applies = rate?.provider === review.modelProvider && rate?.modelName === review.modelName;
      const video = await tx.video.findUniqueOrThrow({ where: { id: lease.job.videoId } });
      await tx.aiUsageRecord.upsert({ where: { attemptId: attempt.id }, update: {}, create: { jobId: lease.job.id, attemptId: attempt.id, userId: lease.job.actorId, isTrial: video.isTrial, stage: lease.job.stage, provider: review.modelProvider, modelName: review.modelName, ...(applies ? { currency: rate.currency, rateVersion: setting!.version, rateSnapshot: setting!.value as Prisma.InputJsonObject } : {}) } });
    });
  }

  async finishCurrent(tx: Prisma.TransactionClient, status: 'succeeded' | 'failed', uncertain = false, error?: unknown) {
    const lease = this.context.getStore();
    if (!lease) throw new EvaluationLeaseLostError();
    await this.assertLease(tx, lease);
    await this.finish(tx, lease.job, lease.token, uncertain ? 'needs_attention' : status,
      uncertain ? 'external_result_uncertain' : status === 'failed' ? 'evaluation_failed' : null);
    if (status === 'failed') {
      const failureCategory = classifyEvaluationError(error);
      await tx.evaluationJob.update({ where: { id: lease.job.id }, data: { failureCategory } });
      await tx.evaluationJobAttempt.update({ where: { fencingToken: lease.token }, data: { failureCategory } });
      await tx.aiUsageRecord.updateMany({ where: { attempt: { fencingToken: lease.token } }, data: { failureCategory } });
    }
  }

  private async finish(tx: Prisma.TransactionClient, job: EvaluationJob, token: string | null, status: string, failureCode: string | null) {
    if (job.stage === 'content' && this.quotas) {
      // The lease snapshot predates the external marker; always reread inside the transaction.
      const current = await tx.evaluationJob.findUniqueOrThrow({ where: { id: job.id } });
      if (current.externalStartedAt || status === 'succeeded') await this.quotas.commit(tx, job.actorId, 'content_evaluations', `content:${job.id}`);
      else await this.quotas.release(tx, job.actorId, 'content_evaluations', `content:${job.id}`);
    }
    await tx.evaluationJob.update({ where: { id: job.id }, data: {
      status, failureCode, completedAt: new Date(), leaseExpiresAt: null, leaseToken: null,
    } });
    if (token) await tx.evaluationJobAttempt.update({ where: { fencingToken: token }, data: {
      status, failureCode, completedAt: new Date(),
    } });
    if (token) await tx.aiUsageRecord.updateMany({ where: { attempt: { fencingToken: token } }, data: { status: status === 'needs_attention' ? 'uncertain' : status, completedAt: new Date() } });
  }

  private async abandon(tx: Prisma.TransactionClient, job: EvaluationJob, status: string, code: string) {
    await this.finish(tx, job, job.leaseToken, status, code);
    const data = { status: 'failed' as const, errorMessage: '任务执行中断；请检查任务记录后手动重新触发。' };
    if (job.contentReviewId) await tx.aiContentReview.updateMany({ where: { id: job.contentReviewId, status: 'running' }, data });
    if (job.resultReviewId) await tx.aiResultReview.updateMany({ where: { id: job.resultReviewId, status: 'running' }, data });
    if (job.finalEvaluationId) await tx.finalVideoEvaluation.updateMany({ where: { id: job.finalEvaluationId, status: 'running' }, data: { ...data, completedAt: new Date() } });
    await tx.video.updateMany({ where: { id: job.videoId, status: expectedStatus[job.stage] }, data: { status: failedStatus[job.stage] } });
    await tx.operationLog.create({ data: {
      userId: job.actorId, videoId: job.videoId, targetType: 'evaluation_job', targetId: job.id,
      actionType: 'evaluation_job_recovered', result: 'failure', comment: code,
      afterValue: { jobStatus: status, stage: job.stage },
    } });
  }

  async recoverExpired() {
    const candidates = await this.prisma.$queryRaw<Array<{ id: string; video_id: string }>>(Prisma.sql`
      SELECT id, video_id FROM evaluation_jobs WHERE status = 'running' AND lease_expires_at <= clock_timestamp()
      ORDER BY lease_expires_at LIMIT 100`);
    for (const candidate of candidates) await this.prisma.$transaction(async (tx) => {
      const videos = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM videos WHERE id = ${candidate.video_id}::uuid FOR UPDATE SKIP LOCKED`);
      if (!videos.length) return;
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM evaluation_jobs WHERE id = ${candidate.id}::uuid
        AND status = 'running' AND lease_expires_at <= clock_timestamp() FOR UPDATE`);
      if (!rows.length) return;
      const job = await tx.evaluationJob.findUniqueOrThrow({ where: { id: candidate.id } });
      if (job.externalStartedAt || job.attempts >= job.maxAttempts) {
        await this.abandon(tx, job, job.externalStartedAt ? 'needs_attention' : 'failed',
          job.externalStartedAt ? 'external_result_uncertain' : 'retry_exhausted');
      } else {
        await tx.evaluationJobAttempt.update({ where: { fencingToken: job.leaseToken! }, data: {
          status: 'expired', completedAt: new Date(), failureCode: 'lease_expired_before_external',
        } });
        await tx.evaluationJob.update({ where: { id: job.id }, data: {
          status: 'retry_wait', leaseToken: null, leaseExpiresAt: null,
          failureCode: 'lease_expired_before_external',
        } });
        await tx.$executeRaw(Prisma.sql`UPDATE evaluation_jobs SET available_at = clock_timestamp() +
          ${Math.min(60000, 1000 * 2 ** job.attempts)} * interval '1 millisecond' WHERE id = ${job.id}::uuid`);
      }
    });
  }

  // Pre-queue running records have no reliable evidence of whether a paid call completed.
  // Retain their raw responses, add a durable diagnostic job, and require manual retry.
  async recoverOrphans() {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; video_id: string; stage: JobStage }>>(Prisma.sql`
      SELECT r.id, r.video_id, 'content' AS stage FROM ai_content_reviews r
      WHERE r.status = 'running' AND NOT EXISTS (SELECT 1 FROM evaluation_jobs j WHERE j.content_review_id = r.id)
      UNION ALL SELECT r.id, r.video_id, 'result' AS stage FROM ai_result_reviews r
      WHERE r.status = 'running' AND NOT EXISTS (SELECT 1 FROM evaluation_jobs j WHERE j.result_review_id = r.id)
      UNION ALL SELECT r.id, r.video_id, 'final' AS stage FROM final_video_evaluations r
      WHERE r.status = 'running' AND NOT EXISTS (SELECT 1 FROM evaluation_jobs j WHERE j.final_evaluation_id = r.id)
      LIMIT 100`);
    for (const row of rows) await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM videos WHERE id = ${row.video_id}::uuid FOR UPDATE SKIP LOCKED`);
      if (!locked.length) return;
      const target = row.stage === 'content' ? { contentReviewId: row.id } : row.stage === 'result' ? { resultReviewId: row.id } : { finalEvaluationId: row.id };
      if (await tx.evaluationJob.findFirst({ where: target })) return;
      if (await tx.evaluationJob.findFirst({ where: { videoId: row.video_id, stage: row.stage, status: { in: active } } })) return;
      const review = row.stage === 'content' ? await tx.aiContentReview.findUnique({ where: { id: row.id } })
        : row.stage === 'result' ? await tx.aiResultReview.findUnique({ where: { id: row.id } })
          : await tx.finalVideoEvaluation.findUnique({ where: { id: row.id } });
      if (review?.status !== 'running') return;
      const video = await tx.video.findUniqueOrThrow({ where: { id: row.video_id } });
      const job = await this.enqueue(tx, { videoId: video.id, actorId: video.creatorId, stage: row.stage, ...target }, true);
      await this.abandon(tx, job, 'needs_attention', 'legacy_external_result_uncertain');
    });
  }

  // Exceptions escaping a stage are retried only before a possibly billable request.
  async releaseAfterExecutionError(lease: EvaluationLease) {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.assertLease(tx, lease);
        await tx.evaluationJob.update({ where: { id: lease.job.id }, data: { leaseExpiresAt: new Date(0) } });
      });
      await this.recoverExpired();
    } catch (error) {
      if (!(error instanceof EvaluationLeaseLostError)) throw error;
    }
  }

  async get(id: string, user: AuthenticatedUser, meta: { ipAddress?: string; userAgent?: string }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new NotFoundException('Task not found.');
    const job = await this.prisma.evaluationJob.findUnique({ where: { id }, include: { video: { include: { creator: { select: { managerId: true } } } } } });
    if (!job) throw new NotFoundException('Task not found.');
    await this.permissions.assertCanAccessVideo(user, job.video, { ...meta, action: 'Evaluation job access denied.' });
    if (user.role === 'visitor' && job.stage !== 'content') throw new ForbiddenException('Visitor cannot access this evaluation.');
    return {
      id: job.id, videoId: job.videoId, stage: job.stage, status: job.status,
      reviewId: job.contentReviewId || job.resultReviewId, evaluationId: job.finalEvaluationId,
      attempts: job.attempts, maxAttempts: job.maxAttempts, failureCode: job.failureCode,
      availableAt: job.availableAt, createdAt: job.createdAt, completedAt: job.completedAt,
    };
  }
}
