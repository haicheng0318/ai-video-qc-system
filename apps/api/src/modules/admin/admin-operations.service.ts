import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { settingSchemas, settingDefaults, readPolicy } from './runtime-policy';
import { PrismaService } from '../prisma/prisma.service';
import { EvaluationJobsService } from '../evaluation-jobs/evaluation-jobs.service';
import { ContentReviewService } from '../ai/gemini/gemini.service';
import { ResultReviewsService } from '../result-reviews/result-reviews.service';
import { FinalEvaluationsService } from '../final-evaluations/final-evaluations.service';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { ControlledActionDto, OperationsQueryDto, SaveSettingDto } from './admin-operations.dto';

const failureCodes = new Set(['external_result_uncertain', 'evaluation_failed', 'retry_exhausted', 'lease_expired_before_external', 'legacy_external_result_uncertain']);
const categories = new Set(['rate_limit', 'configuration', 'timeout', 'parsing', 'source_changed', 'storage', 'refusal', 'provider_or_execution']);
export const jobSelect = { id: true, videoId: true, actorId: true, stage: true, status: true, attempts: true, maxAttempts: true, failureCode: true, failureCategory: true, availableAt: true, createdAt: true, completedAt: true, retriedFromId: true, video: { select: { isTrial: true } }, attemptHistory: { select: { startedAt: true }, orderBy: { attemptNumber: 'asc' }, take: 1 } } satisfies Prisma.EvaluationJobSelect;
export function safeJob(j: any) { const started = j.attemptHistory?.[0]?.startedAt; return { id: j.id, videoId: j.videoId, actorId: j.actorId, isTrial: j.video?.isTrial ?? null, stage: j.stage, status: j.status, attempts: j.attempts, maxAttempts: j.maxAttempts, failureCode: failureCodes.has(j.failureCode) ? j.failureCode : null, failureCategory: categories.has(j.failureCategory) ? j.failureCategory : null, availableAt: j.availableAt, createdAt: j.createdAt, completedAt: j.completedAt, retriedFromId: j.retriedFromId, waitingSeconds: j.createdAt ? Math.max(0, (+new Date(started || j.completedAt || Date.now()) - +new Date(j.createdAt)) / 1000) : null, processingSeconds: started ? Math.max(0, (+new Date(j.completedAt || Date.now()) - +new Date(started)) / 1000) : null }; }
export function safeAttempt(a: any) { return { id: a.id, attemptNumber: a.attemptNumber, status: a.status, startedAt: a.startedAt, externalStartedAt: a.externalStartedAt, completedAt: a.completedAt, failureCode: failureCodes.has(a.failureCode) ? a.failureCode : null, failureCategory: categories.has(a.failureCategory) ? a.failureCategory : null, processingSeconds: a.startedAt ? Math.max(0, (+new Date(a.completedAt || Date.now()) - +new Date(a.startedAt)) / 1000) : null }; }
export const usageSelect = { id: true, jobId: true, attemptId: true, userId: true, isTrial: true, collectionStatus: true, failureCategory: true, stage: true, provider: true, modelName: true, status: true, inputTokens: true, outputTokens: true, estimatedCost: true, actualCost: true, currency: true, rateVersion: true, createdAt: true, completedAt: true } satisfies Prisma.AiUsageRecordSelect;
export function validateSetting(key: string, value: unknown): Prisma.InputJsonObject {
  const schema = settingSchemas[key];
  if (!schema) throw new BadRequestException('Unsupported setting.');
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('Invalid setting value.');
  return parsed.data as Prisma.InputJsonObject;
}
export function summarizeUsage(rows: any[]) {
  const groups = new Map<string, any[]>();
  for (const row of rows) { const key = JSON.stringify([row.stage, row.provider, row.modelName, row.currency]); const list = groups.get(key) || []; list.push(row); groups.set(key, list); }
  const sum = (list: any[], field: string) => { const known = list.filter(r => r[field] !== null && r[field] !== undefined); return known.length ? known.reduce((v, r) => v.add(r[field]), new Prisma.Decimal(0)).toString() : null; };
  return { calls: rows.length, unknownUsageCalls: rows.filter(r => r.inputTokens == null || r.outputTokens == null).length, billingStatus: 'not_connected', groups: [...groups.values()].map(list => ({ stage: list[0].stage, provider: list[0].provider, modelName: list[0].modelName, currency: list[0].currency ?? null, calls: list.length, inputTokens: sum(list, 'inputTokens'), outputTokens: sum(list, 'outputTokens'), estimatedCost: sum(list, 'estimatedCost'), actualCost: sum(list, 'actualCost'), estimateCoverage: list.every(r => r.estimatedCost != null) ? 'complete' : list.some(r => r.estimatedCost != null) ? 'partial' : 'unknown', actualCoverage: list.every(r => r.actualCost != null) ? 'complete' : list.some(r => r.actualCost != null) ? 'partial' : 'unknown', failedCalls: list.filter(r => r.status === 'failed').length, uncertainCalls: list.filter(r => r.status === 'uncertain' || r.status === 'started').length })) };
}
export function csvCell(value: unknown) { let text = value == null ? '' : String(value); if (/^[\s]*[=+\-@\t\r\n]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g, '""')}"`; }
function controlled(input: ControlledActionDto) { if (input.confirmed !== true || !input.reason?.trim() || input.reason.length > 500) throw new BadRequestException('Confirmation and a reason are required.'); }
function range(q: OperationsQueryDto) { const from = q.from ? new Date(q.from) : undefined; const to = q.to ? new Date(q.to) : undefined; if ((from && !Number.isFinite(+from)) || (to && !Number.isFinite(+to)) || (from && to && from > to)) throw new BadRequestException('Invalid date range.'); return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }; }
function page(q: OperationsQueryDto) { const take = Math.min(100, Math.max(1, q.pageSize || 20)); const current = Math.max(1, q.page || 1); return { take, skip: (current - 1) * take, page: current }; }
function trialWhere(q: OperationsQueryDto) { return q.scope === 'formal' ? { isTrial: false } : q.scope === 'trial' ? { isTrial: true } : {}; }
function usageWhere(q: OperationsQueryDto): Prisma.AiUsageRecordWhereInput { return { ...trialWhere(q), ...(q.modelName ? { modelName: q.modelName } : {}), ...(q.stage ? { stage: q.stage } : {}), ...(q.status ? { status: q.status } : {}), ...(q.userId ? { userId: q.userId } : {}), ...(q.videoId ? { job: { videoId: q.videoId } } : {}), createdAt: range(q) }; }
const logSelect = { id: true, userId: true, videoId: true, actionType: true, targetType: true, targetId: true, result: true, createdAt: true } satisfies Prisma.OperationLogSelect;
function logWhere(q: OperationsQueryDto, security = false): Prisma.OperationLogWhereInput { return { ...(q.userId ? { userId: q.userId } : {}), ...(q.actionType ? { actionType: q.actionType } : {}), ...(q.targetType ? { targetType: q.targetType } : {}), ...(q.targetId ? { targetId: q.targetId } : {}), ...(q.result ? { result: q.result } : {}), createdAt: range(q), ...(security ? { AND: [{ actionType: { in: ['management_access_denied', 'login_failed', 'login_success', 'logout', 'sessions_revoked', 'password_changed', 'password_reset', 'permission_denied'] } }] } : {}) }; }

@Injectable()
export class AdminOperationsService {
  constructor(private readonly db: PrismaService, private readonly jobs: EvaluationJobsService, private readonly content: ContentReviewService, private readonly result: ResultReviewsService, private readonly final: FinalEvaluationsService) {}
  async overview(q: OperationsQueryDto = new OperationsQueryDto()) {
    const [users, latest] = await Promise.all([this.db.user.count({ where: { status: 'active', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }), this.db.workerHeartbeat.findFirst({ orderBy: { lastSeenAt: 'desc' }, select: { lastSeenAt: true } })]);
    const alerts = await readPolicy(this.db, 'alerts'); const now = new Date();
    const [formalCount, trialCount, expiringAccounts, visitorAccounts, overdueQueue] = await Promise.all([
      this.db.video.count({ where: { isTrial: false, createdAt: range(q) } }), this.db.video.count({ where: { isTrial: true, createdAt: range(q) } }),
      this.db.user.findMany({ where: { status: 'active', expiresAt: { gt: now, lte: new Date(+now + alerts.expiryWarningDays * 86400000) } }, select: { id: true, name: true, expiresAt: true }, orderBy: { expiresAt: 'asc' }, take: 100 }),
      this.db.user.count({ where: { role: 'visitor', status: 'active', expiresAt: { gt: now } } }),
      this.db.evaluationJob.count({ where: { status: 'queued', createdAt: { lt: new Date(+now - alerts.queueWaitSeconds * 1000) } } }),
    ]);
    const scoped = await Promise.all([false, true].map(async isTrial => ({ isTrial, dated: await this.db.evaluationJob.groupBy({ by: ['stage','status'], where: { video: { isTrial }, createdAt: range(q) }, _count: true }), backlog: await this.db.evaluationJob.groupBy({ by: ['stage','status'], where: { video: { isTrial }, status: { in: ['queued','running','retry_wait','failed','needs_attention'] } }, _count: true }) })));
    return { activeUsers: users, formalVideos: formalCount, trialVideos: trialCount, visitorAccounts, expiringAccounts, currentBacklog: scoped.flatMap(group => group.backlog.map(j => ({ stage: j.stage, status: j.status, isTrial: group.isTrial, count: j._count }))), overdueQueue, alerts, site: await readPolicy(this.db, 'site'), dateRange: { from: q.from || null, to: q.to || null }, jobs: scoped.flatMap(group => group.dated.map(j => ({ stage: j.stage, status: j.status, isTrial: group.isTrial, count: j._count }))), worker: !latest ? 'unknown' : Date.now() - +latest.lastSeenAt < alerts.workerStaleSeconds * 1000 ? 'observed_recently' : 'stale', observedAt: new Date().toISOString() };
  }
  async listJobs(q: OperationsQueryDto) {
    const where: Prisma.EvaluationJobWhereInput = { video: trialWhere(q), ...(q.stage ? { stage: q.stage } : {}), ...(q.status ? { status: q.status } : {}), ...(q.userId ? { actorId: q.userId } : {}), ...(q.videoId ? { videoId: q.videoId } : {}), createdAt: range(q) };
    const p = page(q); const [items, total] = await this.db.$transaction([this.db.evaluationJob.findMany({ where, select: jobSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: p.take, skip: p.skip }), this.db.evaluationJob.count({ where })]);
    return { items: items.map(safeJob), total, page: p.page, pageSize: p.take };
  }
  async jobStatistics(q: OperationsQueryDto) {
    range(q);
    const rows = await this.db.$queryRaw<any[]>(Prisma.sql`
      WITH timings AS (SELECT j.stage, v.is_trial, j.status,
        EXTRACT(EPOCH FROM (COALESCE(a.started_at,j.completed_at,NOW())-j.created_at)) AS waiting,
        EXTRACT(EPOCH FROM (COALESCE(j.completed_at,NOW())-a.started_at)) AS processing
        FROM evaluation_jobs j JOIN videos v ON v.id=j.video_id
        LEFT JOIN LATERAL (SELECT MIN(started_at) AS started_at FROM evaluation_job_attempts WHERE job_id=j.id) a ON true
        WHERE (${q.userId || null}::uuid IS NULL OR j.actor_id=${q.userId || null}::uuid)
        AND (${q.videoId || null}::uuid IS NULL OR j.video_id=${q.videoId || null}::uuid)
        AND (${q.stage || null}::text IS NULL OR j.stage=${q.stage || null})
        AND (${q.status || null}::text IS NULL OR j.status=${q.status || null})
        AND (${q.scope || 'all'}='all' OR v.is_trial=(${q.scope || 'all'}='trial'))
        AND (${q.from ? new Date(q.from) : null}::timestamptz IS NULL OR j.created_at>=${q.from ? new Date(q.from) : null})
        AND (${q.to ? new Date(q.to) : null}::timestamptz IS NULL OR j.created_at<=${q.to ? new Date(q.to) : null}))
      SELECT stage, is_trial AS "isTrial", COUNT(*)::int AS calls,
        COUNT(*) FILTER (WHERE status='succeeded')::float / NULLIF(COUNT(*) FILTER (WHERE status IN ('succeeded','failed','needs_attention')),0) AS "successRate",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY waiting) AS "waitingP50", percentile_cont(0.95) WITHIN GROUP (ORDER BY waiting) AS "waitingP95",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY processing) AS "processingP50", percentile_cont(0.95) WITHIN GROUP (ORDER BY processing) AS "processingP95"
      FROM timings GROUP BY stage,is_trial ORDER BY stage,is_trial`);
    return { groups: rows, successRateDenominator: 'terminal_jobs', durations: 'seconds', processingIncludesRetryGaps: true };
  }
  async job(id: string) {
    const job = await this.db.evaluationJob.findUnique({ where: { id }, select: { ...jobSelect, attemptHistory: { orderBy: { attemptNumber: 'asc' }, select: { id: true, attemptNumber: true, status: true, startedAt: true, externalStartedAt: true, completedAt: true, failureCode: true, failureCategory: true } }, usageRecords: { select: usageSelect } } });
    if (!job) throw new NotFoundException('Task not found.');
    return { ...safeJob(job), attemptsHistory: job.attemptHistory.map(safeAttempt), usage: job.usageRecords };
  }
  async retry(id: string, input: ControlledActionDto, actor: AuthenticatedUser) {
    controlled(input);
    const old = await this.db.evaluationJob.findUnique({ where: { id } });
    if (!old) throw new NotFoundException('Task not found.');
    if (!['failed', 'needs_attention'].includes(old.status)) throw new ConflictException('Only failed or uncertain tasks may be retried.');
    return this.jobs.withAdminRetry(old, actor.id, input.reason.trim(), async () => {
      const refs = old.inputRefs as Record<string, string>;
      if (old.stage === 'result' && !refs.resultMetricId && old.resultReviewId) {
        const review = await this.db.aiResultReview.findUnique({ where: { id: old.resultReviewId } });
        if (review?.videoId !== old.videoId || !review.resultMetricId) throw new ConflictException('Original metric source is unavailable.');
        refs.resultMetricId = review.resultMetricId;
      }
      if (old.stage === 'final' && !refs.ruleEngineResultId && old.finalEvaluationId) {
        const review = await this.db.finalVideoEvaluation.findUnique({ where: { id: old.finalEvaluationId } });
        if (review?.videoId !== old.videoId || !review.ruleEngineResultId) throw new ConflictException('Original rule source is unavailable.');
        refs.ruleEngineResultId = review.ruleEngineResultId;
      }
      if (old.stage === 'content') return this.content.triggerContentReview(old.videoId, actor, {});
      if (old.stage === 'result') return this.result.trigger(old.videoId, { resultMetricId: refs.resultMetricId }, actor, {});
      if (old.stage === 'final') return this.final.trigger(old.videoId, { ruleEngineResultId: refs.ruleEngineResultId }, actor, {});
      throw new ConflictException('Unsupported stage.');
    });
  }
  async ai() {
    const configs = await this.db.aiModelConfig.findMany({ select: { id: true, agentType: true, provider: true, modelName: true, enabled: true, maxTokens: true, updatedAt: true } });
    const calls = await this.db.aiUsageRecord.groupBy({ by: ['stage', 'status', 'isTrial', 'failureCategory', 'collectionStatus'], where: { createdAt: { gte: new Date(Date.now() - 86400000) } }, _count: true, _max: { completedAt: true } });
    return { configs, configured: Boolean(process.env.DASHSCOPE_API_KEY?.trim()), connection: 'not_probed', paidDiagnostic: 'manual_only_not_executed', callsLast24h: calls.map(c => ({ stage: c.stage, isTrial: c.isTrial, status: c.status, failureCategory: categories.has(c.failureCategory || '') ? c.failureCategory : null, collectionStatus: c.collectionStatus, latestCompletedAt: c._max.completedAt, count: c._count })), effectiveFallbacks: [{ stage: 'content', modelName: safeModel(process.env.QWEN_MODEL, 'qwen3.5-omni-plus') }, { stage: 'result', modelName: safeModel(process.env.QWEN_RESULT_REVIEW_MODEL, 'qwen3.5-plus') }, { stage: 'final', modelName: safeModel(process.env.QWEN_FINAL_EVALUATION_MODEL, 'qwen3.5-plus') }] };
  }
  async storage() {
    const now = new Date();
    const retention = await readPolicy(this.db, 'retention');
    const retentionReview = { temporaryObjects: await this.db.temporaryStorageRecord.count({ where: { status: { not: 'cleaned' }, createdAt: { lt: new Date(+now - retention.temporaryHours * 3600000) } } }), auditRecords: await this.db.operationLog.count({ where: { createdAt: { lt: new Date(+now - retention.auditDays * 86400000) } } }), deletion: 'manual_only', policy: retention };
    const [files, pending, errors, cleaned, oss] = await Promise.all([this.db.video.aggregate({ _count: true, _sum: { fileSizeBytes: true } }), this.db.uploadTicket.count({ where: { cleanedAt: null, expiresAt: { lt: now } } }), this.db.uploadTicket.count({ where: { cleanedAt: null, cleanupError: { not: null } } }), this.db.uploadTicket.count({ where: { cleanedAt: { not: null } } }), this.db.temporaryStorageRecord.groupBy({ by: ['provider', 'status'], _count: true })]);
    return { retentionReview, applicationFiles: files._count, applicationBytes: files._sum.fileSizeBytes?.toString() ?? '0', directUploadCleanup: { overdue: pending, failed: errors, cleaned }, temporaryObjects: oss.map(r => ({ provider: r.provider, status: r.status, count: r._count })), cos: { configured: ['TENCENTCLOUD_SECRET_ID', 'TENCENTCLOUD_SECRET_KEY', 'COS_BUCKET', 'COS_REGION'].every(k => Boolean(process.env[k]?.trim())), remoteInventory: 'not_connected' }, oss: { configured: ['OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_BUCKET', 'OSS_REGION'].every(k => Boolean(process.env[k]?.trim())), remoteInventory: 'not_connected', historicalCleanupCoverage: 'unknown_before_collection' }, cloudBilling: 'not_connected' };
  }
  async usage(q: OperationsQueryDto) {
    const p = page(q); const where = usageWhere(q);
    const [items, total] = await this.db.$transaction([this.db.aiUsageRecord.findMany({ where, select: usageSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: p.take, skip: p.skip }), this.db.aiUsageRecord.count({ where })]);
    return { items, total, page: p.page, pageSize: p.take, coverage: 'collection_since_migration_only' };
  }
  async usageSummary(q: OperationsQueryDto) {
    // Database aggregates avoid loading unbounded call histories into API memory.
    const groups = await this.db.aiUsageRecord.groupBy({ by: ['stage', 'provider', 'modelName', 'currency', 'status', 'isTrial', 'collectionStatus', 'failureCategory'], where: usageWhere(q), _sum: { inputTokens: true, outputTokens: true, estimatedCost: true, actualCost: true }, _count: { _all: true, inputTokens: true, outputTokens: true, estimatedCost: true, actualCost: true } });
    return { billingStatus: 'not_connected', coverage: 'collection_since_migration_only', groups: groups.map(g => ({ stage: g.stage, isTrial: g.isTrial, collectionStatus: g.collectionStatus, failureCategory: g.failureCategory, provider: g.provider, modelName: g.modelName, currency: g.currency, status: g.status, calls: g._count._all, inputTokens: g._sum.inputTokens, outputTokens: g._sum.outputTokens, estimatedCost: g._sum.estimatedCost?.toString() ?? null, actualCost: g._sum.actualCost?.toString() ?? null, inputObserved: g._count.inputTokens, outputObserved: g._count.outputTokens, estimateObserved: g._count.estimatedCost, actualObserved: g._count.actualCost })) };
  }
  async exportUsage(q: OperationsQueryDto, input: ControlledActionDto, actor: AuthenticatedUser) {
    controlled(input); const where = usageWhere(q);
    return this.db.$transaction(async tx => {
      await this.assertActor(tx, actor.id);
      const rows = await tx.aiUsageRecord.findMany({ where, select: usageSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1001 });
      if (rows.length > 1000) throw new BadRequestException('Narrow the date range to at most 1000 calls.');
      const fields = Object.keys(usageSelect) as Array<keyof typeof usageSelect>;
      const csv = [fields.map(csvCell).join(','), ...rows.map(r => fields.map(k => csvCell(r[k] instanceof Date ? (r[k] as Date).toISOString() : r[k])).join(','))].join('\r\n');
      await tx.operationLog.create({ data: { userId: actor.id, actionType: 'admin_usage_export', targetType: 'ai_usage', result: 'success', comment: input.reason.trim(), afterValue: { count: rows.length, from: q.from || null, to: q.to || null } } });
      return { filename: 'ai-usage.csv', csv, count: rows.length, billingStatus: 'not_connected' };
    });
  }
  async settings() { return { items: await this.db.runtimeSetting.findMany({ where: { key: { in: Object.keys(settingSchemas) } }, select: { key: true, value: true, version: true, updatedAt: true } }), defaults: settingDefaults, supportedKeys: Object.keys(settingSchemas), effect: '新配置只影响后续操作；保留策略用于标识到期复核，不自动删除原始审计记录。' }; }
  async saveSetting(key: string, dto: SaveSettingDto, actor: AuthenticatedUser) {
    controlled(dto); const value = validateSetting(key, dto.value);
    return this.db.$transaction(async tx => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(701090704)`);
      await this.assertActor(tx, actor.id);
      const current = await tx.runtimeSetting.findUnique({ where: { key } });
      if ((current?.version || 0) !== dto.expectedVersion) throw new ConflictException('Setting changed; refresh before saving.');
      const version = (current?.version || 0) + 1;
      const saved = await tx.runtimeSetting.upsert({ where: { key }, create: { key, value, version }, update: { value, version } });
      if (key === 'evaluation_parameters') {
        const agentType = value.stage === 'result' ? 'result_review' : 'final_evaluation';
        const modelName = String(value.modelName); const provider = 'aliyun_bailian';
        await tx.aiModelConfig.updateMany({ where: { agentType, provider, enabled: true }, data: { enabled: false } });
        await tx.aiModelConfig.upsert({ where: { agentType_provider_modelName: { agentType, provider, modelName } }, create: { agentType, provider, modelName, enabled: true, maxTokens: Number(value.maxOutputTokens) }, update: { enabled: true, maxTokens: Number(value.maxOutputTokens) } });
      }
      await tx.configurationRevision.create({ data: { kind: 'setting', targetId: key, version, value, actorId: actor.id, reason: dto.reason.trim() } });
      await tx.operationLog.create({ data: { userId: actor.id, targetType: 'runtime_setting', targetId: key, actionType: 'admin_setting_updated', result: 'success', comment: dto.reason.trim(), afterValue: { version } } });
      return saved;
    });
  }
  private async assertActor(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`);
    const actor = await tx.user.findUnique({ where: { id } });
    if (!actor || actor.role !== 'admin' || actor.status !== 'active' || actor.mustChangePassword || (actor.expiresAt && +actor.expiresAt <= Date.now())) throw new ForbiddenException('Administrator is no longer active.');
  }
  async revisions(q: OperationsQueryDto) { const p = page(q); const [items, total] = await this.db.$transaction([this.db.configurationRevision.findMany({ select: { id: true, kind: true, targetId: true, version: true, value: true, actorId: true, reason: true, createdAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: p.take, skip: p.skip }), this.db.configurationRevision.count()]); return { items, total, page: p.page, pageSize: p.take }; }
  async logs(q: OperationsQueryDto, security = false) {
    const p = page(q); const where = logWhere(q, security);
    const [items, total] = await this.db.$transaction([this.db.operationLog.findMany({ where, select: { id: true, userId: true, videoId: true, actionType: true, targetType: true, targetId: true, result: true, createdAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: p.take, skip: p.skip }), this.db.operationLog.count({ where })]);
    return { items, total, page: p.page, pageSize: p.take };
  }
  async sessions(q: OperationsQueryDto) { const p = page(q); const where = { ...(q.userId ? { userId: q.userId } : {}), createdAt: range(q) }; const [items, total] = await this.db.$transaction([this.db.userSession.findMany({ where, select: { id: true, userId: true, expiresAt: true, revokedAt: true, createdAt: true, user: { select: { status: true, expiresAt: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: p.take, skip: p.skip }), this.db.userSession.count({ where })]); return { items: items.map(s => ({ id: s.id, userId: s.userId, createdAt: s.createdAt, expiresAt: s.expiresAt, revokedAt: s.revokedAt, active: !s.revokedAt && +s.expiresAt > Date.now() && s.user.status === 'active' && (!s.user.expiresAt || +s.user.expiresAt > Date.now()) })), total, page: p.page, pageSize: p.take }; }
  async exportLogs(q: OperationsQueryDto, input: ControlledActionDto, actor: AuthenticatedUser, security = false) {
    controlled(input);
    return this.db.$transaction(async tx => {
      await this.assertActor(tx, actor.id);
      const rows = await tx.operationLog.findMany({ where: logWhere(q, security), select: logSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1001 });
      if (rows.length > 1000) throw new BadRequestException('请缩小筛选范围至1000条以内。');
      const fields = Object.keys(logSelect) as Array<keyof typeof logSelect>;
      const csv = [fields.map(csvCell).join(','), ...rows.map(r => fields.map(k => csvCell(r[k] instanceof Date ? (r[k] as Date).toISOString() : r[k])).join(','))].join('\r\n');
      await tx.operationLog.create({ data: { userId: actor.id, actionType: 'admin_logs_export', targetType: security ? 'security_events' : 'operation_logs', result: 'success', comment: input.reason.trim(), afterValue: { count: rows.length } } });
      return { filename: security ? 'security-events.csv' : 'operation-logs.csv', csv, count: rows.length };
    });
  }
  async readiness() { try { await this.db.$queryRaw`SELECT 1`; return { status: 'ready', database: 'available' }; } catch { return { status: 'not_ready', database: 'unavailable' }; } }
  async dependencies() { const ready = await this.readiness(); let worker: any = { status: 'unknown', lastSeenAt: null }; const alerts = ready.status === 'ready' ? await readPolicy(this.db, 'alerts') : settingDefaults.alerts; if (ready.status === 'ready') { const seen = await this.db.workerHeartbeat.findFirst({ orderBy: { lastSeenAt: 'desc' }, select: { lastSeenAt: true } }); worker = { status: !seen ? 'unknown' : Date.now() - +seen.lastSeenAt < alerts.workerStaleSeconds * 1000 ? 'observed_recently' : 'stale', lastSeenAt: seen?.lastSeenAt ?? null }; } return { applicationVersion: safeModel(process.env.APP_VERSION, 'not_connected'), deployedAt: process.env.DEPLOYED_AT && /^\d{4}-\d{2}-\d{2}T[\d:.Z+-]+$/.test(process.env.DEPLOYED_AT) ? process.env.DEPLOYED_AT : null, api: 'alive', database: ready.database, worker, ai: 'not_probed', storage: 'not_probed', resources: 'not_connected', backups: 'not_connected', certificates: 'not_connected', cloudBilling: 'not_connected', paidDiagnostic: 'manual_only_not_executed' }; }
}
function safeModel(value: string | undefined, fallback: string) { return value && /^[a-zA-Z0-9._-]{1,100}$/.test(value) ? value : fallback; }
