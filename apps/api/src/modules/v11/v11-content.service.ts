import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, InternalServerErrorException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { EvaluationJob, Prisma, UserRole, VideoStatus } from '@prisma/client';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { effectiveQwenModelConfig, QwenClient, QWEN_CLIENT, QwenEffectiveModelConfig } from '../ai/gemini/qwen.client';
import { sanitizeContentReviewText } from '../ai/gemini/gemini.service';
import { readPolicy } from '../admin/runtime-policy';
import { EvaluationJobsService } from '../evaluation-jobs/evaluation-jobs.service';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { VideoStorageService } from '../storage/video-storage.service';
import { calculateV11ContentScore, V11_CONTENT_RATING_VERSION } from './content-scoring';
import { buildV11ContentPrompt } from './content-prompt';
import { assertEvidenceWithinDuration, V11ContentModelOutputSchema, v11ContentResponseJsonSchema } from './content-schema';
import { createMediaManifest } from './media-manifest';
import { decideFirstRunReview, decideReviewProgress, ReviewRun } from './review-engine';
import { evaluateContentGate } from './gate-engine';
import {
  buildEvaluationFingerprint,
  canonicalize,
  sha256,
  V11_PREPROCESSING_VERSION,
  V11_PROMPT_VERSION,
  V11_REFERENCE_SET_VERSION,
  V11_RUBRIC_VERSION,
  V11_SCHEMA_VERSION,
} from './provenance';

type RequestMeta = { ipAddress?: string; userAgent?: string };
type TriggerOptions = { independent: boolean; pilotRun: boolean; bypassReason: string | null };

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeFailure(error: unknown) {
  return sanitizeContentReviewText(error instanceof Error ? error.message : 'V1.1 content evaluation failed.', 500)
    || 'V1.1 content evaluation failed.';
}

function worstCompliance(statuses: string[]) {
  if (statuses.includes('confirmed')) return 'confirmed';
  if (statuses.includes('suspected')) return 'suspected';
  return 'clear';
}

export async function countQualifiedInitialPilotSamples(tx: Pick<Prisma.TransactionClient, '$queryRaw'>) {
  const rows = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(DISTINCT g.video_id) AS count
    FROM v11_evaluation_decisions d
    JOIN v11_evaluation_groups g ON g.id = d.group_id
    WHERE d.input_complete = true
      AND d.stable = true
      AND g.parent_group_id IS NULL
      AND g.independent = false
      AND g.pilot_run = false
      AND g.trigger_reason <> 'appeal'
  `);
  return Number(rows[0]?.count ?? 0);
}

@Injectable()
export class V11ContentService {
  private readonly logger = new Logger(V11ContentService.name);
  constructor(
    private readonly db: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly logs: OperationLogsService,
    private readonly storage: VideoStorageService,
    private readonly jobs: EvaluationJobsService,
    @Inject(QWEN_CLIENT) private readonly qwen: QwenClient,
  ) {}

  async trigger(videoId: string, user: AuthenticatedUser, meta: RequestMeta) {
    return this.safeTrigger(videoId, user, meta, { independent: false, pilotRun: false, bypassReason: null });
  }

  async triggerPilot(videoId: string, body: unknown, user: AuthenticatedUser, meta: RequestMeta) {
    if (user.role !== UserRole.admin) throw new ForbiddenException('Administrator required.');
    const reason = typeof (body as { bypassReason?: unknown })?.bypassReason === 'string'
      ? (body as { bypassReason: string }).bypassReason.trim()
      : '';
    if (reason.length < 10 || reason.length > 500) {
      throw new BadRequestException('Pilot bypass reason must be 10-500 characters.');
    }
    return this.safeTrigger(videoId, user, meta, { independent: true, pilotRun: true, bypassReason: reason });
  }

  private async safeTrigger(videoId: string, user: AuthenticatedUser, meta: RequestMeta, options: TriggerOptions) {
    try {
      return await this.triggerInternal(videoId, user, meta, options);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const diagnostics: string[] = [];
      let cause = error;
      for (let depth = 0; cause instanceof Error && depth < 3; depth += 1) {
        diagnostics.push(cause.stack || `${cause.name}: ${cause.message}`);
        cause = (cause as Error & { cause?: unknown }).cause;
      }
      this.logger.error(`V1.1 trigger failed for video ${videoId}.`,
        sanitizeContentReviewText(diagnostics.join('\nCaused by: '), 8000));
      if (error instanceof Error && error.message === 'Video file is unavailable.') {
        throw new ServiceUnavailableException('原始视频文件当前不可用，无法发起评估。');
      }
      throw new InternalServerErrorException('V1.1 评估任务启动失败，请稍后重试或联系管理员。');
    }
  }

  private async triggerInternal(videoId: string, user: AuthenticatedUser, meta: RequestMeta, options: TriggerOptions) {
    if (!isUuid(videoId)) throw new NotFoundException('Video not found.');
    const feature = await readPolicy(this.db, 'v11_content_shadow');
    if (!feature.enabled) throw new ConflictException('V1.1 content scoring shadow mode is disabled.');
    if (feature.shadowMode && !options.pilotRun) {
      throw new ConflictException('V1.1 formal content evaluation is not enabled.');
    }
    const shadowMode = options.pilotRun ? true : feature.shadowMode;
    const video = await this.db.video.findUnique({ where: { id: videoId } });
    if (!video) throw new NotFoundException('Video not found.');
    await this.permissions.assertCanTriggerContentReview(user, video, meta);

    const materialized = await this.storage.materialize(video.filePath);
    let media;
    try {
      media = await createMediaManifest(materialized.path, {
        sizeBytes: video.fileSizeBytes,
        durationSeconds: video.duration,
      });
    } finally {
      await materialized.cleanup();
    }
    const metadataSnapshot = {
      title: video.title,
      brand: video.brand,
      product: video.product,
      platform: video.platform,
      videoType: video.videoType,
      scriptDescription: video.scriptDescription,
      isForAds: video.isForAds,
      isEventVideo: video.isEventVideo,
      eventName: video.eventName,
      relatedRequirement: video.relatedRequirement,
    };
    const metadataSnapshotHash = sha256(canonicalize(metadataSnapshot));
    const model = await this.db.aiModelConfig.findFirst({
      where: { enabled: true, provider: 'aliyun_bailian', agentType: { in: ['content_review_v11', 'content_review'] } },
      orderBy: [{ agentType: 'asc' }, { createdAt: 'asc' }],
    });
    const modelConfigSnapshot = effectiveQwenModelConfig({
      modelName: model?.modelName || process.env.QWEN_MODEL || 'qwen3.5-omni-plus',
      temperature: model?.temperature === null || model?.temperature === undefined ? null : Number(model.temperature),
      maxTokens: model?.maxTokens ?? null,
      region: process.env.QWEN_REGION?.trim() || 'cn',
    });
    const fingerprint = buildEvaluationFingerprint({
      ownerId: video.creatorId,
      fileHash: media.manifest.fileHash,
      metadataSnapshotHash,
      mediaManifestHash: media.manifestHash,
      modelConfigSnapshot,
      promptVersion: V11_PROMPT_VERSION,
      schemaVersion: V11_SCHEMA_VERSION,
      rubricVersion: V11_RUBRIC_VERSION,
      ratingVersion: V11_CONTENT_RATING_VERSION,
      preprocessingVersion: V11_PREPROCESSING_VERSION,
      referenceSetVersion: V11_REFERENCE_SET_VERSION,
    });

    const created = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
      const duplicate = options.independent ? null : await tx.v11EvaluationGroup.findFirst({
        where: {
          ownerId: video.creatorId,
          stage: 'content',
          shadowMode,
          independent: false,
          pilotRun: false,
          status: { in: ['queued', 'running', 'review_required', 'adopted'] },
          inputRevision: { evaluationFingerprint: fingerprint },
        },
        include: { runs: { orderBy: { runNumber: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      });
      if (duplicate) return { duplicate: true, group: duplicate, job: null };
      const latestInput = await tx.v11EvaluationInputRevision.findFirst({ where: { videoId }, orderBy: { revision: 'desc' } });
      const inputRevision = await tx.v11EvaluationInputRevision.create({
        data: {
          videoId,
          ownerId: video.creatorId,
          revision: (latestInput?.revision ?? 0) + 1,
          fileHash: media.manifest.fileHash,
          metadataSnapshot,
          metadataSnapshotHash,
          mediaManifest: media.manifest as unknown as Prisma.InputJsonObject,
          mediaManifestHash: media.manifestHash,
          modelConfigSnapshot,
          promptVersion: V11_PROMPT_VERSION,
          schemaVersion: V11_SCHEMA_VERSION,
          rubricVersion: V11_RUBRIC_VERSION,
          ratingVersion: V11_CONTENT_RATING_VERSION,
          preprocessingVersion: V11_PREPROCESSING_VERSION,
          referenceSetVersion: V11_REFERENCE_SET_VERSION,
          evaluationFingerprint: fingerprint,
          inputComplete: media.inputComplete,
          incompleteReasons: media.incompleteReasons,
        },
      });
      let workflow = await tx.v11WorkflowRevision.findFirst({ where: { videoId, status: 'current' } });
      const activeDecision = workflow?.activeContentDecisionId
        ? await tx.v11EvaluationDecision.findUnique({
          where: { id: workflow.activeContentDecisionId },
          include: { group: { select: { shadowMode: true } } },
        })
        : null;
      const workflowMode = activeDecision?.group.shadowMode
        ?? (workflow?.policySnapshot && typeof workflow.policySnapshot === 'object' && !Array.isArray(workflow.policySnapshot)
          ? (workflow.policySnapshot as Prisma.JsonObject).shadowMode
          : undefined);
      if (workflow && typeof workflowMode === 'boolean' && workflowMode !== shadowMode) {
        await tx.v11WorkflowRevision.update({ where: { id: workflow.id }, data: { status: 'superseded', supersededAt: new Date() } });
        await tx.v11EvaluationRun.updateMany({ where: { group: { workflowRevisionId: workflow.id }, status: { in: ['pending', 'running'] } }, data: { status: 'stale', stale: true, completedAt: new Date() } });
        await tx.v11EvaluationGroup.updateMany({ where: { workflowRevisionId: workflow.id, status: { in: ['queued', 'running', 'review_required'] } }, data: { status: 'superseded' } });
        workflow = await tx.v11WorkflowRevision.create({
          data: { videoId, ownerId: video.creatorId, revision: workflow.revision + 1, policySnapshot: { shadowMode, cutoverFromWorkflowRevisionId: workflow.id } },
        });
      }
      if (!workflow) {
        workflow = await tx.v11WorkflowRevision.create({ data: { videoId, ownerId: video.creatorId, revision: 1, policySnapshot: { shadowMode } } });
      }
      const group = await tx.v11EvaluationGroup.create({
        data: {
          videoId,
          ownerId: video.creatorId,
          inputRevisionId: inputRevision.id,
          workflowRevisionId: workflow.id,
          triggerReason: options.pilotRun ? 'pilot_independent' : 'formal_manual',
          shadowMode,
          independent: options.independent,
          pilotRun: options.pilotRun,
          bypassReason: options.bypassReason,
        },
      });
      const blindContextHash = sha256(canonicalize({ metadataSnapshot, mediaManifest: media.manifest, rubricVersion: V11_RUBRIC_VERSION }));
      const run = await tx.v11EvaluationRun.create({ data: {
        groupId: group.id,
        runNumber: 1,
        runRole: 'primary',
        status: 'pending',
        blindContextHash,
        modelProvider: modelConfigSnapshot.provider,
        modelName: modelConfigSnapshot.modelName,
        modelConfigSnapshot,
        promptVersion: V11_PROMPT_VERSION,
        schemaVersion: V11_SCHEMA_VERSION,
        rubricVersion: V11_RUBRIC_VERSION,
        ratingVersion: V11_CONTENT_RATING_VERSION,
        preprocessingVersion: V11_PREPROCESSING_VERSION,
        referenceSetVersion: V11_REFERENCE_SET_VERSION,
      } });
      const job = await this.jobs.enqueue(tx, {
        videoId,
        actorId: user.id,
        stage: 'v11_content',
        v11RunId: run.id,
        inputRefs: { workflowRevisionId: workflow.id, inputRevisionId: inputRevision.id },
        maxAttempts: options.pilotRun ? 1 : 2,
      });
      if (!shadowMode && !options.pilotRun) {
        await tx.video.update({ where: { id: videoId }, data: { status: VideoStatus.ai_content_reviewing } });
      }
      await this.logs.create({ userId: user.id, videoId, targetType: 'v11_evaluation_group', targetId: group.id, actionType: options.pilotRun ? 'v11_content_pilot_started' : 'v11_content_review_started', result: 'started', comment: options.bypassReason ?? undefined, afterValue: { fingerprint, inputRevisionId: inputRevision.id, workflowRevision: workflow.revision, independent: options.independent, pilotRun: options.pilotRun, shadowMode }, ipAddress: meta.ipAddress, userAgent: meta.userAgent }, tx);
      return { duplicate: false, group: { ...group, runs: [run] }, job };
    });
    return { groupId: created.group.id, runId: created.group.runs[0]?.id, status: created.group.status, shadowMode: created.group.shadowMode, duplicate: created.duplicate, ...(created.job ? { jobId: created.job.id } : {}) };
  }

  async executeJob(job: EvaluationJob) {
    if (!job.v11RunId) throw new Error('V1.1 evaluation run is missing.');
    const run = await this.db.v11EvaluationRun.findUnique({ where: { id: job.v11RunId }, include: { group: { include: { inputRevision: true, workflowRevision: true } } } });
    if (!run || !['pending', 'running'].includes(run.status)) return;
    await this.db.$transaction(async (tx) => {
      await this.jobs.assertCurrent(tx, job.videoId, run.id);
      const currentGroup = await tx.v11EvaluationGroup.findUniqueOrThrow({ where: { id: run.groupId } });
      if (currentGroup.technicalAttemptCount >= 6) throw new Error('V1.1 technical attempt limit reached.');
      await tx.v11EvaluationRun.update({ where: { id: run.id }, data: { status: 'running', technicalAttempts: job.attempts } });
      await tx.v11EvaluationGroup.update({ where: { id: run.groupId }, data: { status: 'running', technicalAttemptCount: { increment: 1 } } });
    });
    let rawText: string | undefined;
    try {
      const video = await this.db.video.findUniqueOrThrow({ where: { id: job.videoId } });
      const materialized = await this.storage.materialize(video.filePath);
      try {
        const currentMedia = await createMediaManifest(materialized.path, { sizeBytes: video.fileSizeBytes, durationSeconds: video.duration });
        if (currentMedia.manifest.fileHash !== run.group.inputRevision.fileHash) throw new Error('Evaluation source file changed.');
        await this.jobs.markExternalStarted();
        const response = await this.qwen.analyzeVideo(
          materialized.path,
          video.mimeType,
          run.modelConfigSnapshot as unknown as QwenEffectiveModelConfig,
          buildV11ContentPrompt(
            run.group.inputRevision.metadataSnapshot as Record<string, unknown>,
            v11ContentResponseJsonSchema as unknown as Record<string, unknown>,
          ),
          { name: 'v11_video_content_review', schema: v11ContentResponseJsonSchema as unknown as Record<string, unknown> },
        );
        rawText = response.rawResponse;
      } finally {
        await materialized.cleanup();
      }
      const parsed = V11ContentModelOutputSchema.parse(JSON.parse(rawText!));
      const manifest = run.group.inputRevision.mediaManifest as { durationSeconds?: number | null; hasAudio?: boolean | null };
      assertEvidenceWithinDuration(parsed, manifest.durationSeconds ?? null);
      const calculated = calculateV11ContentScore({ dimensions: parsed.dimensions, compliance: parsed.compliance });
      const factsHash = sha256(canonicalize(parsed.dimensions.map((item) => ({ dimension: item.dimension, facts: item.facts }))));
      await this.db.$transaction(async (tx) => {
        await this.jobs.assertCurrent(tx, job.videoId, run.id);
        const pilot = run.group.pilotRun || run.group.independent;
        const currentWorkflow = await tx.v11WorkflowRevision.findUniqueOrThrow({ where: { id: run.group.workflowRevisionId } });
        if (!pilot && currentWorkflow.status !== 'current') {
          await tx.v11EvaluationRun.update({ where: { id: run.id }, data: { status: 'stale', stale: true, completedAt: new Date() } });
          await tx.v11EvaluationGroup.updateMany({ where: { id: run.groupId, status: { in: ['queued', 'running', 'review_required'] } }, data: { status: 'superseded' } });
          await this.jobs.finishCurrent(tx, 'failed', false, new Error('Workflow revision is stale.'));
          return;
        }
        await tx.v11EvaluationRun.update({ where: { id: run.id }, data: {
          status: 'succeeded', structuredOutput: parsed, rawResponse: { rawText: sanitizeContentReviewText(rawText) }, totalScore: calculated.totalScore, contentRating: calculated.contentRating, complianceStatus: parsed.compliance.status, factsHash, completedAt: new Date(),
        } });
        const succeeded = await tx.v11EvaluationRun.findMany({ where: { groupId: run.groupId, status: 'succeeded' }, orderBy: { runNumber: 'asc' } });
        await tx.v11EvaluationGroup.update({ where: { id: run.groupId }, data: { validRunCount: succeeded.length } });
        const inputComplete = run.group.inputRevision.inputComplete && calculated.complete;
        if (pilot) {
          await tx.v11EvaluationGroup.update({ where: { id: run.groupId }, data: { status: inputComplete ? 'pilot_completed' : 'pilot_incomplete' } });
          await this.logs.create({
            userId: job.actorId,
            videoId: job.videoId,
            targetType: 'v11_evaluation_run',
            targetId: run.id,
            actionType: 'v11_content_pilot_completed',
            result: inputComplete ? 'success' : 'incomplete',
            afterValue: { totalScore: calculated.totalScore, contentRating: calculated.contentRating, inputComplete },
          }, tx);
          await this.jobs.finishCurrent(tx, 'succeeded');
          return;
        }
        if (!inputComplete) {
          await tx.v11WorkflowHold.create({ data: { videoId: job.videoId, workflowRevisionId: run.group.workflowRevisionId, groupId: run.groupId, holdType: 'input_incomplete', reason: '关键媒体或评分维度不可观察，不能形成正式评分。' } });
          await tx.v11EvaluationGroup.update({ where: { id: run.groupId }, data: { status: 'hold' } });
          if (!run.group.shadowMode) {
            await tx.video.update({ where: { id: job.videoId }, data: { status: VideoStatus.ai_content_failed } });
          }
          await this.jobs.finishCurrent(tx, 'succeeded');
          return;
        }
        const reviewRuns = succeeded.map((item) => {
          const output = item.structuredOutput as {
            dimensions: Array<{
              dimension: string;
              anchor: number;
              factClaims: Array<{ key: string; state: 'present' | 'absent' | 'uncertain' }>;
            }>;
          };
          return {
            score: Number(item.totalScore),
            rating: item.contentRating!,
            anchors: Object.fromEntries(output.dimensions.map((dimension) => [dimension.dimension, dimension.anchor])),
            factsHash: item.factsHash!,
            factClaims: output.dimensions.flatMap((dimension) => dimension.factClaims.map((claim) => ({
              dimension: dimension.dimension,
              key: claim.key,
              state: claim.state,
            }))),
            complianceStatus: item.complianceStatus!,
          } as ReviewRun;
        });
        let progress: ReturnType<typeof decideReviewProgress> | {
          action: 'adopt';
          method: 'single_after_pilot';
          anchors: ReviewRun['anchors'];
          totalScore: number;
          contentRating: ReviewRun['rating'];
        };
        if (reviewRuns.length === 1) {
          const eligiblePilotCount = await countQualifiedInitialPilotSamples(tx);
          const comparableHistory = await tx.v11EvaluationDecision.findFirst({
            where: {
              groupId: { not: run.groupId },
              inputComplete: true,
              group: {
                videoId: job.videoId,
                inputRevision: {
                  rubricVersion: run.group.inputRevision.rubricVersion,
                  ratingVersion: run.group.inputRevision.ratingVersion,
                  preprocessingVersion: run.group.inputRevision.preprocessingVersion,
                },
              },
            },
            orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }],
            select: { totalScore: true },
          });
          progress = decideFirstRunReview({ run: reviewRuns[0], mediaManifest: manifest, eligiblePilotCount, fingerprint: run.group.inputRevision.evaluationFingerprint, comparableHistoricalScore: comparableHistory ? Number(comparableHistory.totalScore) : null, appeal: run.group.triggerReason === 'appeal' })
            ? { action: 'second_review' }
            : { action: 'adopt', method: 'single_after_pilot', anchors: reviewRuns[0].anchors, totalScore: reviewRuns[0].score, contentRating: reviewRuns[0].rating };
        } else {
          progress = decideReviewProgress(reviewRuns);
        }
        if (progress.action === 'second_review' || progress.action === 'third_review') {
          await this.jobs.finishCurrent(tx, 'succeeded');
          const nextNumber = succeeded.length + 1;
          const nextRun = await tx.v11EvaluationRun.create({ data: {
            groupId: run.groupId,
            runNumber: nextNumber,
            runRole: nextNumber === 2 ? 'independent_review' : 'third_review',
            status: 'pending',
            blindContextHash: run.blindContextHash,
            modelProvider: run.modelProvider,
            modelName: run.modelName,
            modelConfigSnapshot: run.modelConfigSnapshot as Prisma.InputJsonValue,
            promptVersion: run.promptVersion,
            schemaVersion: run.schemaVersion,
            rubricVersion: run.rubricVersion,
            ratingVersion: run.ratingVersion,
            preprocessingVersion: run.preprocessingVersion,
            referenceSetVersion: run.referenceSetVersion,
          } });
          await this.jobs.enqueue(tx, { videoId: job.videoId, actorId: job.actorId, stage: 'v11_content', v11RunId: nextRun.id, inputRefs: { workflowRevisionId: run.group.workflowRevisionId, inputRevisionId: run.group.inputRevisionId }, maxAttempts: 2 });
          await tx.v11EvaluationGroup.update({ where: { id: run.groupId }, data: { status: 'review_required' } });
          return;
        }
        if (progress.action === 'hold') {
          await tx.v11WorkflowHold.create({ data: { videoId: job.videoId, workflowRevisionId: run.group.workflowRevisionId, groupId: run.groupId, holdType: 'evaluation_instability', reason: `评估结果存在严重分歧：${progress.reason}` } });
          await tx.v11EvaluationGroup.update({ where: { id: run.groupId }, data: { status: 'hold' } });
          if (!run.group.shadowMode) {
            await tx.video.update({ where: { id: job.videoId }, data: { status: VideoStatus.ai_content_failed } });
          }
          await this.logs.create({ userId: job.actorId, videoId: job.videoId, targetType: 'v11_evaluation_group', targetId: run.groupId, actionType: 'v11_content_review_held', result: 'hold', comment: progress.reason }, tx);
          await this.jobs.finishCurrent(tx, 'succeeded');
          return;
        }
        const adoptedDimensions = Object.entries(progress.anchors).map(([dimension, anchor]) => ({ dimension, anchor }));
        const decision = await tx.v11EvaluationDecision.create({ data: {
          groupId: run.groupId,
          workflowRevisionId: run.group.workflowRevisionId,
          sourceRunIds: succeeded.map((item) => item.id),
          adoptedDimensions,
          totalScore: progress.totalScore,
          contentRating: progress.contentRating,
          complianceStatus: worstCompliance(succeeded.map((item) => item.complianceStatus!)),
          inputComplete: true,
          stable: true,
          decisionSource: 'system',
          adoptionMethod: progress.method,
        } });
        await tx.v11WorkflowRevision.update({ where: { id: run.group.workflowRevisionId }, data: { activeContentDecisionId: decision.id } });
        await tx.v11EvaluationGroup.update({ where: { id: run.groupId }, data: { status: 'adopted' } });
        if (run.group.triggerReason === 'appeal') {
          await tx.v11Appeal.updateMany({ where: { rerunGroupId: run.groupId, status: 'active' }, data: { status: 'resolved', resolvedAt: new Date() } });
          await tx.v11WorkflowHold.updateMany({ where: { groupId: run.groupId, holdType: 'appeal', status: 'active' }, data: { status: 'resolved', resolvedAt: new Date() } });
        }
        if (!run.group.shadowMode) {
          const policy = await readPolicy(tx, 'v11_workflow_gates');
          const [hasHold, hasAppeal] = await Promise.all([
            tx.v11WorkflowHold.count({ where: { workflowRevisionId: run.group.workflowRevisionId, status: 'active' } }),
            tx.v11Appeal.count({ where: { workflowRevisionId: run.group.workflowRevisionId, status: 'active' } }),
          ]);
          const gate = evaluateContentGate({ manualEnabled: policy.manualContentReviewEnabled, rating: progress.contentRating, stable: true, inputComplete: true, complianceStatus: worstCompliance(succeeded.map((item) => item.complianceStatus!)), hasHold: hasHold > 0, hasAppeal: hasAppeal > 0, stale: false });
          if (gate.decision === 'approved' || gate.decision === 'revision_required') {
            await tx.v11WorkflowGateDecision.create({ data: { videoId: job.videoId, workflowRevisionId: run.group.workflowRevisionId, stage: 'content', decision: gate.decision, decisionSource: 'system', reason: gate.decision === 'approved' ? '稳定、完整且合规清晰的内容评估通过自动关卡。' : '内容评级为 C/D，自动进入优化返修。', performanceEligible: false } });
            await tx.video.update({ where: { id: job.videoId }, data: { status: gate.decision === 'approved' ? 'approved_for_publish' : 'revision_required' } });
          } else if (gate.decision === 'manual_review') {
            await tx.video.update({ where: { id: job.videoId }, data: { status: 'pending_supervisor_review' } });
          }
        }
        await this.logs.create({ userId: job.actorId, videoId: job.videoId, targetType: 'v11_evaluation_decision', targetId: decision.id, actionType: run.group.shadowMode ? 'v11_content_shadow_completed' : 'v11_content_review_completed', result: 'success', afterValue: { contentRating: progress.contentRating, totalScore: progress.totalScore, runCount: succeeded.length, shadowMode: run.group.shadowMode } }, tx);
        await this.jobs.finishCurrent(tx, 'succeeded');
      });
    } catch (error) {
      await this.db.$transaction(async (tx) => {
        await tx.v11EvaluationRun.updateMany({ where: { id: run.id, status: { in: ['pending', 'running'] } }, data: { status: 'failed', errorMessage: safeFailure(error), rawResponse: rawText ? { rawText: sanitizeContentReviewText(rawText, 20_000) } : undefined, completedAt: new Date() } });
        await tx.v11EvaluationGroup.updateMany({ where: { id: run.groupId, status: { in: ['queued', 'running'] } }, data: { status: 'failed' } });
        if (!run.group.shadowMode) {
          await tx.video.update({ where: { id: job.videoId }, data: { status: VideoStatus.ai_content_failed } });
        }
        await this.logs.create({ userId: job.actorId, videoId: job.videoId, targetType: 'v11_evaluation_run', targetId: run.id, actionType: run.group.shadowMode ? 'v11_content_shadow_failed' : 'v11_content_review_failed', result: 'failure', comment: safeFailure(error), afterValue: { shadowMode: run.group.shadowMode } }, tx);
        await this.jobs.finishCurrent(tx, 'failed', false, error);
      });
    }
  }

  async latest(videoId: string, user: AuthenticatedUser) {
    if (!isUuid(videoId)) throw new NotFoundException('Video not found.');
    const video = await this.permissions.findVideoVisibleToUser(videoId, user);
    if (!video) throw new NotFoundException('Video not found.');
    const workflow = await this.db.v11WorkflowRevision.findFirst({
      where: { videoId, status: 'current' },
      orderBy: { revision: 'desc' },
      select: { activeContentDecisionId: true },
    });
    const businessWhere = { videoId, pilotRun: false, independent: false } as const;
    const group = await this.db.v11EvaluationGroup.findFirst({
      where: workflow?.activeContentDecisionId
        ? { ...businessWhere, decision: { is: { id: workflow.activeContentDecisionId } } }
        : businessWhere,
      ...(workflow?.activeContentDecisionId ? {} : { orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }] }),
      include: { runs: { orderBy: { runNumber: 'asc' }, select: { id: true, runNumber: true, runRole: true, status: true, totalScore: true, contentRating: true, complianceStatus: true, stale: true, completedAt: true } }, decision: { select: { id: true, totalScore: true, contentRating: true, complianceStatus: true, inputComplete: true, stable: true, decisionSource: true, adoptionMethod: true, decidedAt: true } }, workflowRevision: { select: { revision: true, status: true } } },
    });
    return { shadowMode: group?.shadowMode ?? false, group };
  }
}
