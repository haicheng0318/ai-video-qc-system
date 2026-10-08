import assert from 'node:assert/strict';
import { assertIsolatedDatabase } from '../test-support/local-acceptance';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { ContentReviewService } from '../modules/ai/gemini/gemini.service';
import { OperationLogsService } from '../modules/operation-logs/operation-logs.service';
import { ResultReviewsService } from '../modules/result-reviews/result-reviews.service';
import { FinalEvaluationsService } from '../modules/final-evaluations/final-evaluations.service';
import { PermissionsService } from '../modules/permissions/permissions.service';
import { ForbiddenException } from '@nestjs/common';
import { contentDimensionCodes } from '../modules/ai/gemini/content-scoring';

const successfulContentResponse = (contentSummary = '清晰') => JSON.stringify({
  contentSummary,
  isPublishableRecommendation: true,
  mainProblems: [],
  revisionSuggestions: [],
  complianceRisks: [],
  usableScenarios: [],
  scores: contentDimensionCodes.map((dimension) => ({
    dimension,
    rating: 5,
    evidence: `${dimension}证据充分`,
    timestamp: null,
  })),
});

const url = process.env.EVALUATION_JOBS_TEST_DATABASE_URL;
test('PostgreSQL queue: atomic enqueue, global claim, lease fencing and uncertain-call recovery', { skip: !url }, async () => {
  assertIsolatedDatabase(url);
  const path = '../modules/evaluation-jobs/evaluation-jobs.service';
  const module = await import(path).catch(() => ({}));
  assert.equal(typeof module.EvaluationJobsService, 'function', 'durable queue must exist');
  const db = new PrismaClient({ datasourceUrl: url });
  const jobs = new module.EvaluationJobsService(db, { assertCanAccessVideo: async () => undefined });
  const actor = await db.user.create({ data: { account: `queue-${randomUUID()}`, name: 'Queue test', passwordHash: 'unused', role: 'admin' } });
  const videos: string[] = [];
  const extraUsers: string[] = [];
  async function fixture() {
    const video = await db.video.create({ data: { title: 'Queue test', originalFileName: 'test.mp4', filePath: 'cos://test/video.mp4', mimeType: 'video/mp4', fileSizeBytes: 1, videoType: 'other', creatorId: actor.id, status: 'ai_content_reviewing' } });
    videos.push(video.id);
    const review = await db.aiContentReview.create({ data: { videoId: video.id, modelProvider: 'aliyun_bailian', modelName: 'test', status: 'running' } });
    return { videoId: video.id, stage: 'content', actorId: actor.id, contentReviewId: review.id };
  }
  try {
    const first = await fixture();
    await assert.rejects(db.$transaction(async (tx) => {
      await jobs.enqueue(tx, first);
      throw new Error('rollback');
    }), /rollback/);
    assert.equal(await (db as any).evaluationJob.count(), 0);
    const second = await fixture();
    await assert.rejects(db.$transaction((tx) => jobs.enqueue(tx, { ...first, videoId: second.videoId })), /source binding/);
    await assert.rejects(db.$transaction((tx) => jobs.enqueue(tx, { ...first, inputRefs: { signedUrl: 'https://private.example/?signature=secret' } })), /source references/);
    const a: any = await db.$transaction((tx) => jobs.enqueue(tx, first));
    await assert.rejects(db.$transaction((tx) => jobs.enqueue(tx, first)));
    await db.$transaction((tx) => jobs.enqueue(tx, second));
    const claims = await Promise.all([jobs.claim('worker-a'), jobs.claim('worker-b')]);
    assert.equal(claims.filter(Boolean).length, 1, JSON.stringify(await db.$queryRaw`SELECT status, available_at, clock_timestamp() FROM evaluation_jobs`));
    const lease = claims.find(Boolean);
    assert.equal(lease.job.id, a.id);
    await assert.rejects(db.$transaction((tx) => jobs.assertLease(tx, { ...lease, token: 'stale-token' })));
    await (db as any).evaluationJob.update({ where: { id: a.id }, data: { leaseExpiresAt: new Date(0) } });
    assert.equal(await jobs.heartbeat(lease), false, 'expired workers cannot renew');
    await jobs.recoverExpired();
    const retry = await (db as any).evaluationJob.findUnique({ where: { id: a.id } });
    assert.equal(retry.status, 'retry_wait');
    assert.equal(await (db as any).evaluationJobAttempt.count({ where: { jobId: a.id } }), 1);
    await (db as any).evaluationJob.update({ where: { id: a.id }, data: { availableAt: new Date(0) } });
    const fresh = await jobs.claim('worker-c');
    assert.notEqual(fresh.token, lease.token);
    await assert.rejects(db.$transaction((tx) => jobs.assertLease(tx, lease)));
    await jobs.runWithLease(fresh, async () => jobs.markExternalStarted());
    await (db as any).evaluationJob.update({ where: { id: a.id }, data: { leaseExpiresAt: new Date(0) } });
    await jobs.recoverExpired();
    assert.equal((await (db as any).evaluationJob.findUnique({ where: { id: a.id } })).status, 'needs_attention');
    assert.equal((await db.aiContentReview.findUnique({ where: { id: first.contentReviewId } }))?.status, 'failed');
    assert.equal((await db.video.findUnique({ where: { id: first.videoId } }))?.status, 'ai_content_failed');
    const publicJob = await jobs.get(a.id, actor, {});
    assert.equal(publicJob.status, 'needs_attention');
    for (const hidden of ['inputRefs', 'actorId', 'leaseToken', 'workerId', 'errorMessage', 'rawResponse']) assert.equal(hidden in publicJob, false);
    const next = await jobs.claim('worker-d');
    assert.equal(next.job.videoId, second.videoId);
    await assert.rejects(jobs.runWithLease(next, () => db.$transaction(async (tx) => {
      await jobs.assertCurrent(tx, second.videoId, second.contentReviewId);
      await tx.aiContentReview.update({ where: { id: second.contentReviewId }, data: { status: 'succeeded' } });
      await jobs.finishCurrent(tx, 'succeeded');
      throw new Error('result transaction rollback');
    })), /result transaction rollback/);
    assert.equal((await (db as any).evaluationJob.findUnique({ where: { id: next.job.id } })).status, 'running');
    assert.equal((await db.aiContentReview.findUnique({ where: { id: second.contentReviewId } }))?.status, 'running');
    await jobs.runWithLease(next, () => db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${second.videoId}::uuid FOR UPDATE`);
      await jobs.assertCurrent(tx, second.videoId, second.contentReviewId);
      await tx.aiContentReview.update({ where: { id: second.contentReviewId }, data: { status: 'succeeded' } });
      await jobs.finishCurrent(tx, 'succeeded');
    }));
    assert.equal((await (db as any).evaluationJob.findUnique({ where: { id: next.job.id } })).status, 'succeeded');

    // Break caught: trigger runs provider in API memory instead of returning durable jobId.
    const third = await fixture();
    await db.aiContentReview.delete({ where: { id: third.contentReviewId } });
    await db.video.update({ where: { id: third.videoId }, data: { status: 'submitted' } });
    let calls = 0;
    const service = new ContentReviewService(db as any,
      { assertCanTriggerContentReview: async () => undefined } as any,
      new OperationLogsService(db as any),
      { analyzeVideo: async () => { calls += 1; return { rawResponse: successfulContentResponse() }; } } as any,
      undefined, { isCosPath: () => true, materialize: async () => ({ path: '/test/video.mp4', cleanup: async () => undefined }) } as any,
      jobs);
    const triggered = await service.triggerContentReview(third.videoId, actor, {});
    assert.equal(typeof (triggered as any).jobId, 'string');
    assert.equal(calls, 0, 'API must not invoke provider');
    const workerPath = '../modules/evaluation-jobs/evaluation-worker';
    const workerModule = await import(workerPath).catch(() => ({}));
    if (workerModule.EvaluationWorker) await new workerModule.EvaluationWorker(jobs, service, {}, {}).runOnce();
    assert.equal(calls, 1);
    assert.equal((await db.aiContentReview.findUnique({ where: { id: triggered.reviewId } }))?.status, 'succeeded');
    assert.equal((await (db as any).evaluationJob.findUnique({ where: { id: (triggered as any).jobId } })).status, 'succeeded');
    const metric = await db.videoResultMetric.create({ data: { videoId: third.videoId, videoType: 'other', submittedBy: actor.id } });
    await db.supervisorReview.create({ data: { videoId: third.videoId, reviewerId: actor.id, decision: 'approved_for_publish', isAllowedToPublish: true } });
    await db.video.update({ where: { id: third.videoId }, data: { status: 'pending_result_data' } });
    await db.video.update({ where: { id: third.videoId }, data: { platform: 'queue-test-platform' } });
    const benchmark = await db.platformBenchmark.create({ data: { platform: 'queue-test-platform', videoType: 'other', metricName: 'views', aThreshold: 100, direction: 'higher_is_better' } });
    let savedBenchmarks: any;
    const resultService = new ResultReviewsService(db as any,
      { assertCanTriggerResultReview: async () => undefined } as any, new OperationLogsService(db as any),
      { reviewResultData: async (input: any) => { savedBenchmarks = input.inputContext.benchmarks; return { parsedOutput: { dataScore: 85, dataGrade: 'A', dataSufficiency: 'sufficient', isBusinessEffectiveRecommendation: true, resultSummary: '达标', performanceProblems: [], attributionAnalysis: [], optimizationSuggestions: [] } }; } } as any,
      () => { throw new Error('API scheduled an in-memory result task'); }, jobs);
    const resultTriggered = await resultService.trigger(third.videoId, { resultMetricId: metric.id }, actor, {});
    assert.equal(typeof (resultTriggered as any).jobId, 'string');
    await db.platformBenchmark.update({ where: { id: benchmark.id }, data: { aThreshold: 9999 } });
    await db.platformBenchmark.delete({ where: { id: benchmark.id } });
    await new workerModule.EvaluationWorker(jobs, service, resultService, {}).runOnce();
    assert.equal(savedBenchmarks[0]?.aThreshold, '100', 'queued result review must use original threshold after source modification/deletion');
    const snapshot = await (db as any).evaluationInputSnapshot.findFirst({ where: { videoId: third.videoId } });
    assert.deepEqual(snapshot.benchmarkIds, [benchmark.id]);
    await assert.rejects((db as any).evaluationInputSnapshot.update({ where: { id: snapshot.id }, data: { data: {} } }), /immutable/);
    assert.equal((await db.aiResultReview.findUnique({ where: { id: resultTriggered.reviewId } }))?.status, 'succeeded');
    const rule = await db.ruleEngineResult.create({ data: {
      videoId: third.videoId, contentReviewId: triggered.reviewId, resultReviewId: resultTriggered.reviewId,
      contentGrade: 'S', dataGrade: 'A', dataSufficiency: 'sufficient', ruleVersion: 'rule-engine-v1',
      ruleCode: 'R11_CONTENT_HIGH_DATA_HIGH', ruleResult: 'excellent_effective_candidate', ruleReason: 'test', recommendedBoundary: 'allow_final_effective',
    } });
    await db.video.update({ where: { id: third.videoId }, data: { status: 'pending_final_evaluation' } });
    const finalService = new FinalEvaluationsService(db as any,
      { assertCanTriggerFinalEvaluation: async () => undefined } as any, new OperationLogsService(db as any),
      { generateFinalEvaluation: async () => ({ parsedOutput: { recommendedFinalGrade: 'effective', recommendedFinalStatus: 'final_effective', recommendedIsEffective: true, recommendationConfidence: 90, decisionSummary: '有效建议', evidenceAssessment: [], finalAttribution: [], finalSuggestion: '待确认', confirmationFocus: [], riskFlags: [] } }) } as any,
      () => { throw new Error('API scheduled an in-memory final task'); }, jobs);
    const finalTriggered = await finalService.trigger(third.videoId, { ruleEngineResultId: rule.id }, actor, {});
    assert.equal(typeof (finalTriggered as any).jobId, 'string');
    await new workerModule.EvaluationWorker(jobs, service, resultService, finalService).runOnce();
    const final = await db.finalVideoEvaluation.findUniqueOrThrow({ where: { id: finalTriggered.evaluationId } });
    assert.equal(final.status, 'succeeded');
    assert.equal(final.confirmedBy, null, 'worker never confirms final decisions');
    assert.equal((await db.video.findUnique({ where: { id: third.videoId } }))?.status, 'pending_final_confirmation');
    const orphan = await fixture();
    await db.aiContentReview.update({ where: { id: orphan.contentReviewId }, data: { createdAt: new Date(0) } });
    await assert.rejects(service.triggerContentReview(orphan.videoId, actor, {}), /awaiting durable recovery/);
    await jobs.recoverOrphans?.();
    assert.equal((await db.aiContentReview.findUnique({ where: { id: orphan.contentReviewId } }))?.status, 'failed', 'startup must surface pre-queue orphaned AI runs');
    const orphanJob = await (db as any).evaluationJob.findFirst({ where: { contentReviewId: orphan.contentReviewId } });
    assert.equal(orphanJob.status, 'needs_attention');
    assert.equal(orphanJob.failureCode, 'legacy_external_result_uncertain');
    const secureJobs = new module.EvaluationJobsService(db, new PermissionsService(db as any, new OperationLogsService(db as any)));
    const outsider = await db.user.create({ data: { account: `outsider-${randomUUID()}`, name: 'Unrelated director', passwordHash: 'unused', role: 'director' } });
    extraUsers.push(outsider.id);
    await assert.rejects(secureJobs.get(a.id, outsider, {}), ForbiddenException);
    const exhausted = await fixture();
    const exhaustedJob: any = await db.$transaction((tx) => jobs.enqueue(tx, exhausted));
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await (db as any).evaluationJob.update({ where: { id: exhaustedJob.id }, data: { availableAt: new Date(0) } });
      const claim = await jobs.claim('retry-worker');
      assert.equal(claim.job.attempts, attempt);
      await (db as any).evaluationJob.update({ where: { id: exhaustedJob.id }, data: { leaseExpiresAt: new Date(0) } });
      await jobs.recoverExpired();
    }
    assert.equal((await (db as any).evaluationJob.findUnique({ where: { id: exhaustedJob.id } })).status, 'failed');
    assert.equal(await jobs.claim('fourth-attempt'), null, 'retry count is bounded');
    const rollback = await fixture();
    await db.aiContentReview.delete({ where: { id: rollback.contentReviewId } });
    await db.video.update({ where: { id: rollback.videoId }, data: { status: 'submitted' } });
    const failingJobs = new module.EvaluationJobsService(db, {});
    failingJobs.enqueue = async (tx: any, input: any) => { await jobs.enqueue(tx, input); throw new Error('queue persistence rollback'); };
    const atomicTrigger = new ContentReviewService(db as any, { assertCanTriggerContentReview: async () => undefined } as any,
      new OperationLogsService(db as any), {} as any, undefined, undefined, failingJobs);
    await assert.rejects(atomicTrigger.triggerContentReview(rollback.videoId, actor, {}), /queue persistence rollback/);
    assert.equal(await db.aiContentReview.count({ where: { videoId: rollback.videoId } }), 0);
    assert.equal(await (db as any).evaluationJob.count({ where: { videoId: rollback.videoId } }), 0);
    assert.equal((await db.video.findUnique({ where: { id: rollback.videoId } }))?.status, 'submitted');

    // An old provider response must not overwrite a manually retried/new review.
    const race = await fixture();
    await db.aiContentReview.delete({ where: { id: race.contentReviewId } });
    await db.video.update({ where: { id: race.videoId }, data: { status: 'submitted' } });
    let signalStarted!: () => void;
    let finishProvider!: (value: any) => void;
    const startedProvider = new Promise<void>((resolve) => { signalStarted = resolve; });
    const provider = new Promise<any>((resolve) => { finishProvider = resolve; });
    const racing = new ContentReviewService(db as any, { assertCanTriggerContentReview: async () => undefined } as any,
      new OperationLogsService(db as any), { analyzeVideo: () => { signalStarted(); return provider; } } as any,
      undefined, { isCosPath: () => true, materialize: async () => ({ path: '/test/race.mp4', cleanup: async () => undefined }) } as any, jobs);
    const old = await racing.triggerContentReview(race.videoId, actor, {});
    const oldLease = await jobs.claim('old-worker');
    const processing = jobs.runWithLease(oldLease, () => racing.executeJob(oldLease.job));
    const rejected = assert.rejects(processing, /lease or source binding/);
    await startedProvider;
    await (db as any).evaluationJob.update({ where: { id: old.jobId }, data: { leaseExpiresAt: new Date(0) } });
    await jobs.recoverExpired();
    const replacement = await service.triggerContentReview(race.videoId, actor, {});
    const replacementLease = await jobs.claim('replacement-worker');
    await jobs.runWithLease(replacementLease, () => service.executeJob(replacementLease.job));
    finishProvider({ rawResponse: successfulContentResponse('迟到结果') });
    await rejected;
    assert.equal((await db.aiContentReview.findUnique({ where: { id: old.reviewId } }))?.rawResponse, null);
    assert.equal((await db.aiContentReview.findUnique({ where: { id: replacement.reviewId } }))?.status, 'succeeded');
    assert.equal((await db.video.findUnique({ where: { id: race.videoId } }))?.status, 'pending_supervisor_review');
  } finally {
    await db.aiUsageRecord.deleteMany({ where: { userId: actor.id } });
    await db.$executeRaw(Prisma.sql`DELETE FROM evaluation_job_attempts WHERE job_id IN (SELECT id FROM evaluation_jobs WHERE actor_id = ${actor.id}::uuid)`);
    await db.$executeRaw(Prisma.sql`DELETE FROM evaluation_jobs WHERE actor_id = ${actor.id}::uuid`);
    await db.$executeRaw(Prisma.sql`DELETE FROM evaluation_input_snapshots WHERE actor_id = ${actor.id}::uuid`);
    await db.operationLog.deleteMany({ where: { videoId: { in: videos } } });
    await db.contentReviewScore.deleteMany({ where: { aiContentReview: { videoId: { in: videos } } } });
    await db.finalVideoEvaluation.deleteMany({ where: { videoId: { in: videos } } });
    await db.ruleEngineResult.deleteMany({ where: { videoId: { in: videos } } });
    await db.aiResultReview.deleteMany({ where: { videoId: { in: videos } } });
    await db.videoResultMetric.deleteMany({ where: { videoId: { in: videos } } });
    await db.supervisorReview.deleteMany({ where: { videoId: { in: videos } } });
    await db.aiContentReview.deleteMany({ where: { videoId: { in: videos } } });
    await db.video.deleteMany({ where: { id: { in: videos } } });
    await db.user.delete({ where: { id: actor.id } });
    await db.user.deleteMany({ where: { id: { in: extraUsers } } });
    await db.$disconnect();
  }
});
