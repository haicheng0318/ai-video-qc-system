import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AiReviewStatus, EvaluationJob, Prisma, VideoStatus } from '@prisma/client';
import { EvaluationJobsService, EvaluationLeaseLostError } from '../../evaluation-jobs/evaluation-jobs.service';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { AuthenticatedUser } from '../../../types/authenticated-user';
import { OperationLogAction } from '../../operation-logs/operation-log-actions';
import { OperationLogsService } from '../../operation-logs/operation-logs.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { VideoStorageService } from '../../storage/video-storage.service';
import { QwenClient, QWEN_CLIENT } from './qwen.client';
import {
  ContentReviewConfigurationError,
  ContentReviewFileProcessingError,
  ContentReviewOutputValidationError,
  ContentReviewTimeoutError,
} from './gemini.errors';
import { buildContentReviewPrompt, CONTENT_REVIEW_PROMPT_VERSION } from './gemini.prompt';
import { ContentReviewOutput, validateContentReviewOutput } from './gemini.schema';
import { calculateContentScore } from './content-scoring';

export const CONTENT_REVIEW_BACKGROUND_SCHEDULER = Symbol('CONTENT_REVIEW_BACKGROUND_SCHEDULER');
export type ContentReviewBackgroundTask = () => Promise<void>;
export type ContentReviewBackgroundScheduler = (task: ContentReviewBackgroundTask) => void;

type RequestMeta = { ipAddress?: string; userAgent?: string };

function rootDir() {
  return resolve(process.cwd(), '../../');
}

function storageDir() {
  return resolve(rootDir(), process.env.VIDEO_STORAGE_DIR || './storage/videos');
}

function safeVideoPath(filePath: string) {
  const base = storageDir();
  const absolutePath = resolve(rootDir(), filePath);
  const pathFromStorage = relative(base, absolutePath);
  if (!pathFromStorage || pathFromStorage.startsWith('..') || isAbsolute(pathFromStorage)) {
    throw new ContentReviewFileProcessingError('Video file path is invalid.');
  }
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    throw new ContentReviewFileProcessingError('Video file is unavailable.');
  }
  return absolutePath;
}

function timeoutMs() {
  const value = Number(process.env.QWEN_REQUEST_TIMEOUT_MS || 300_000);
  return Number.isInteger(value) && value > 0 ? value : 120_000;
}

function runningStaleMinutes() {
  const value = Number(process.env.QWEN_RUNNING_STALE_MINUTES || 15);
  return Number.isFinite(value) && value > 0 ? value : 10;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function sanitizeContentReviewText(value: string | undefined, maxLength?: number) {
  if (!value) return undefined;
  let sanitized = value;
  const configuredSecrets = [
    process.env.DASHSCOPE_API_KEY,
    process.env.OSS_ACCESS_KEY_ID,
    process.env.OSS_ACCESS_KEY_SECRET,
    process.env.TENCENTCLOUD_SECRET_ID,
    process.env.TENCENTCLOUD_SECRET_KEY,
    process.env.TENCENTCLOUD_SESSION_TOKEN,
  ]
    .map((secret) => secret?.trim()).filter(Boolean) as string[];
  for (const secret of configuredSecrets) {
    sanitized = sanitized.split(secret).join('[redacted]');
  }
  sanitized = sanitized
    .replace(/Bearer\s+[^"',}\]\s]+/gi, 'Bearer [redacted]')
    .replace(/(https?:\/\/[^?\s]+)\?[^\s]+/gi, '$1?[query-redacted]')
    .replace(/(?:\/Users|\/private|\/home)\/[^"'\s]+/g, '[path]');
  return maxLength ? sanitized.slice(0, maxLength) : sanitized;
}

function failureDiagnostic(error: unknown) {
  const details: string[] = [];
  let current = error;
  for (let depth = 0; current && depth < 3; depth += 1) {
    if (!(current instanceof Error)) {
      details.push(String(current));
      break;
    }
    const providerError = current as Error & { code?: unknown; status?: unknown; cause?: unknown };
    details.push([
      providerError.name,
      typeof providerError.status === 'number' ? `status=${providerError.status}` : undefined,
      typeof providerError.code === 'string' ? `code=${providerError.code}` : undefined,
      providerError.message,
    ].filter(Boolean).join(' '));
    current = providerError.cause;
  }
  return sanitizeContentReviewText(details.join(' <- '), 1000) || 'Unknown content review failure.';
}

function sanitizeOutput(output: ContentReviewOutput) {
  const sanitized = sanitizeContentReviewText(JSON.stringify(output));
  if (!sanitized) throw new ContentReviewOutputValidationError('Video content review output was empty.');
  return validateContentReviewOutput(JSON.parse(sanitized));
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(
      () => rejectPromise(new ContentReviewTimeoutError('Qwen content review request timed out.')),
      milliseconds,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error) => {
        clearTimeout(timer);
        rejectPromise(error);
      },
    );
  });
}

function failureMessage(error: unknown) {
  if (error instanceof ContentReviewConfigurationError) return 'Qwen content review is not configured.';
  if (error instanceof ContentReviewOutputValidationError) return 'Qwen returned an invalid structured result.';
  if (error instanceof ContentReviewTimeoutError) return 'Qwen video processing timed out.';
  if (error instanceof ContentReviewFileProcessingError) return 'Qwen video processing failed.';
  return 'Qwen content review failed.';
}

@Injectable()
export class ContentReviewService {
  private readonly logger = new Logger(ContentReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionsService: PermissionsService,
    private readonly operationLogsService: OperationLogsService,
    @Inject(QWEN_CLIENT) private readonly contentReviewClient: QwenClient,
    @Optional() @Inject(CONTENT_REVIEW_BACKGROUND_SCHEDULER)
    private readonly backgroundScheduler?: ContentReviewBackgroundScheduler,
    @Optional() private readonly injectedVideoStorage?: VideoStorageService,
    @Optional() private readonly jobs?: EvaluationJobsService,
  ) {}

  async triggerContentReview(
    videoId: string,
    user: AuthenticatedUser,
    requestMeta: RequestMeta,
  ) {
    if (!this.jobs && !this.backgroundScheduler) throw new Error('Persistent evaluation queue is required.');
    if (!isUuid(videoId)) throw new NotFoundException('Video not found.');
    const video = await this.prisma.video.findUnique({ where: { id: videoId } });
    if (!video) throw new NotFoundException('Video not found.');
    await this.permissionsService.assertCanTriggerContentReview(user, video, requestMeta);

    const started = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
      const currentVideo = await transaction.video.findUnique({ where: { id: videoId } });
      if (!currentVideo) throw new NotFoundException('Video not found.');
      await this.jobs?.assertNoActive(transaction, videoId, 'content');

      const runningReviews = await transaction.aiContentReview.findMany({
        where: { videoId, status: AiReviewStatus.running },
        orderBy: { createdAt: 'desc' },
      });
      if (this.jobs && runningReviews.length) throw new ConflictException('Legacy evaluation is awaiting durable recovery.');
      const staleBefore = new Date(Date.now() - runningStaleMinutes() * 60_000);
      const freshRunningReview = runningReviews.find((review) => review.createdAt > staleBefore);
      if (freshRunningReview) {
        throw new ConflictException('A content review is already running for this video.');
      }

      for (const staleReview of runningReviews) {
        await transaction.aiContentReview.update({
          where: { id: staleReview.id },
          data: {
            status: AiReviewStatus.failed,
            errorMessage: 'Recovered stale running content review.',
          },
        });
        await transaction.video.update({
          where: { id: videoId },
          data: { status: VideoStatus.ai_content_failed },
        });
        await this.operationLogsService.create({
          userId: user.id,
          videoId,
          targetType: 'ai_content_review',
          targetId: staleReview.id,
          actionType: OperationLogAction.AiContentReviewRecovered,
          result: 'failure',
          comment: 'Recovered stale running content review.',
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        }, transaction);
      }

      const recoveredStaleReview = runningReviews.length > 0;
      const statusAllowsTrigger =
        currentVideo.status === VideoStatus.submitted ||
        currentVideo.status === VideoStatus.ai_content_failed ||
        (currentVideo.status === VideoStatus.ai_content_reviewing && recoveredStaleReview);
      if (!statusAllowsTrigger) {
        throw new ConflictException('Video status does not allow content review.');
      }

      const modelConfig = await transaction.aiModelConfig.findFirst({
        where: {
          enabled: true,
          provider: 'aliyun_bailian',
          agentType: { in: ['content_review', 'video_content_review'] },
        },
        orderBy: { createdAt: 'asc' },
      });
      const modelName = modelConfig?.modelName || process.env.QWEN_MODEL || 'qwen3.5-omni-plus';
      const review = await transaction.aiContentReview.create({
        data: {
          videoId,
          modelProvider: 'aliyun_bailian',
          modelName,
          status: AiReviewStatus.running,
        },
      });
      await transaction.video.update({
        where: { id: videoId },
        data: { status: VideoStatus.ai_content_reviewing },
      });
      await this.operationLogsService.create({
        userId: user.id,
        videoId,
        targetType: 'ai_content_review',
        targetId: review.id,
        actionType: OperationLogAction.AiContentReviewStarted,
        result: 'started',
        comment: 'Qwen-Omni content review started.',
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      }, transaction);
      const job = await this.jobs?.enqueue(transaction, { videoId, actorId: user.id, stage: 'content', contentReviewId: review.id });
      return { reviewId: review.id, modelName, jobId: job?.id };
    });

    if (!this.jobs) this.runContentReviewInBackground(started.reviewId, videoId, started.modelName, user, requestMeta);
    return { reviewId: started.reviewId, status: AiReviewStatus.running, ...(started.jobId ? { jobId: started.jobId } : {}) };
  }

  async executeJob(job: EvaluationJob) {
    const review = await this.prisma.aiContentReview.findUniqueOrThrow({ where: { id: job.contentReviewId! } });
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: job.actorId } });
    await this.processContentReview(review.id, job.videoId, review.modelName, actor, {});
  }

  runContentReviewInBackground(
    reviewId: string,
    videoId: string,
    modelName: string,
    user: AuthenticatedUser,
    requestMeta: RequestMeta,
  ) {
    const task = async () => {
      try {
        await this.processContentReview(reviewId, videoId, modelName, user, requestMeta);
      } catch (error) {
        await this.handleBackgroundFailure(reviewId, videoId, user, requestMeta, error);
      }
    };

    if (this.backgroundScheduler) {
      this.backgroundScheduler(task);
      return;
    }

    throw new Error('Persistent evaluation queue is required.');
  }

  private async processContentReview(
    reviewId: string,
    videoId: string,
    modelName: string,
    user: AuthenticatedUser,
    requestMeta: RequestMeta,
  ) {
    let rawResponse: string | undefined;
    let receivedAudit: { rawResponse?: string; usage?: Record<string, number> | null; usageCollectionStatus?: string } | undefined;
    try {
      const review = await this.prisma.aiContentReview.findUnique({ where: { id: reviewId } });
      if (!review || review.status !== AiReviewStatus.running) return;
      const video = await this.prisma.video.findUnique({ where: { id: videoId } });
      if (!video) throw new ContentReviewFileProcessingError('Video record is unavailable.');

      let materialized: { path: string; cleanup: () => Promise<void> };
      try {
        materialized = this.videoStorage.isCosPath(video.filePath)
          ? await this.videoStorage.materialize(video.filePath)
          : { path: safeVideoPath(video.filePath), cleanup: async () => undefined };
      } catch (error) {
        throw new ContentReviewFileProcessingError('Video file is unavailable.', error);
      }
      const prompt = buildContentReviewPrompt({
        platform: video.platform,
        videoType: video.videoType,
        brand: video.brand,
        product: video.product,
        isForAds: video.isForAds,
        isEventVideo: video.isEventVideo,
        eventName: video.eventName,
        scriptDescription: video.scriptDescription,
        relatedRequirement: video.relatedRequirement,
      });
      let result;
      try {
        await this.jobs?.markExternalStarted();
        result = await withTimeout(
          this.contentReviewClient.analyzeVideo(materialized.path, video.mimeType, modelName, prompt),
          timeoutMs(),
        );
        rawResponse = result.rawResponse;
        receivedAudit = { rawResponse, usage: result.usage, usageCollectionStatus: result.usageCollectionStatus };
      } finally {
        await materialized.cleanup();
      }
      const responseText = result.rawResponse;
      rawResponse = responseText;
      let parsed: unknown;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        throw new ContentReviewOutputValidationError('Qwen content review response was not valid JSON.');
      }
      const output = sanitizeOutput(validateContentReviewOutput(parsed));
      const calculated = calculateContentScore({
        videoType: video.videoType,
        scores: output.scores,
        complianceRisks: output.complianceRisks,
      });
      const sanitizedRawText = sanitizeContentReviewText(rawResponse);
      if (!sanitizedRawText) throw new ContentReviewOutputValidationError('Qwen content review response was empty.');

      await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
        await this.jobs?.assertCurrent(transaction, videoId, reviewId);
        const currentReview = await transaction.aiContentReview.findUnique({ where: { id: reviewId } });
        if (!currentReview || currentReview.status !== AiReviewStatus.running) return;

        await transaction.aiContentReview.update({
          where: { id: reviewId },
          data: {
            contentSummary: output.contentSummary,
            totalScore: calculated.totalScore,
            contentGrade: calculated.contentGrade,
            isPublishableRecommendation:
              output.isPublishableRecommendation && calculated.hardCap === 100,
            mainProblems: output.mainProblems,
            revisionSuggestions: output.revisionSuggestions,
            complianceRisks: output.complianceRisks,
            usableScenarios: output.usableScenarios,
            scoringVersion: calculated.scoringVersion,
            promptVersion: CONTENT_REVIEW_PROMPT_VERSION,
            rawResponse: {
              rawText: sanitizedRawText,
              usage: result.usage || null,
              usageCollectionStatus: result.usageCollectionStatus || 'unknown',
              parsedModelOutput: output,
              calculated,
            },
            status: AiReviewStatus.succeeded,
            errorMessage: null,
          },
        });
        await transaction.contentReviewScore.createMany({
          data: output.scores.map((score) => ({
            aiContentReviewId: reviewId,
            dimension: score.dimension,
            score: score.rating,
            maxScore: 5,
            comment: score.timestamp
              ? `${score.evidence}（时间点：${score.timestamp}）`
              : score.evidence,
          })),
        });
        await transaction.video.update({
          where: { id: videoId },
          data: { status: VideoStatus.pending_supervisor_review },
        });
        await this.operationLogsService.create({
          userId: user.id,
          videoId,
          targetType: 'ai_content_review',
          targetId: reviewId,
          actionType: OperationLogAction.AiContentReviewCompleted,
          result: 'success',
          comment: 'Qwen-Omni content review completed.',
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        }, transaction);
        await this.jobs?.finishCurrent(transaction, 'succeeded');
      });
    } catch (error) {
      if (error instanceof EvaluationLeaseLostError) throw error;
      this.logger.error('Qwen content review processing failed.', failureDiagnostic(error));
      await this.markFailed(reviewId, videoId, user, requestMeta, rawResponse, error, receivedAudit);
    }
  }

  private get videoStorage() {
    return this.injectedVideoStorage ?? new VideoStorageService();
  }

  async latest(videoId: string, user: AuthenticatedUser, requestMeta: RequestMeta, reviewId?: string) {
    if (!isUuid(videoId)) throw new NotFoundException('Video not found.');
    if (reviewId !== undefined && !isUuid(reviewId)) throw new NotFoundException('Content review not found.');
    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      include: { creator: { select: { managerId: true } } },
    });
    if (!video) throw new NotFoundException('Video not found.');
    await this.permissionsService.assertCanAccessVideo(user, video, {
      ...requestMeta,
      action: 'Content review access denied.',
    });
    const review = await this.prisma.aiContentReview.findFirst({
      where: { videoId, ...(reviewId ? { id: reviewId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { scores: true },
    });
    if (reviewId && !review) throw new NotFoundException('Content review not found.');
    // Audit opening the latest result, not every read-only polling heartbeat.
    if (!reviewId) await this.operationLogsService.create({
      userId: user.id,
      videoId,
      targetType: 'video',
      targetId: videoId,
      actionType: OperationLogAction.AiContentReviewViewed,
      result: 'success',
      comment: 'Latest video content review viewed.',
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });
    if (!review) return { videoStatus: video.status, review: null };
    return {
      videoStatus: video.status,
      review: {
        id: review.id,
        modelProvider: review.modelProvider,
        modelName: review.modelName,
        contentSummary: review.contentSummary,
        totalScore: review.totalScore,
        contentGrade: review.contentGrade,
        isPublishableRecommendation: review.isPublishableRecommendation,
        mainProblems: review.mainProblems,
        revisionSuggestions: review.revisionSuggestions,
        complianceRisks: review.complianceRisks,
        usableScenarios: review.usableScenarios,
        scoringVersion: review.scoringVersion,
        promptVersion: review.promptVersion,
        scoreCalculation: review.scoringVersion === 'content-score-v2'
          ? 'backend_deterministic'
          : 'legacy_model_reported',
        status: review.status,
        errorMessage: review.errorMessage,
        createdAt: review.createdAt,
        scores: review.scores,
      },
    };
  }

  private async markFailed(
    reviewId: string,
    videoId: string,
    user: AuthenticatedUser,
    requestMeta: RequestMeta,
    rawResponse: string | undefined,
    error: unknown,
    receivedAudit?: { rawResponse?: string; usage?: Record<string, number> | null; usageCollectionStatus?: string },
  ) {
    const message = failureMessage(error);
    const received = (error as { audit?: { rawResponse?: string; usage?: Record<string, number>; usageCollectionStatus?: string } })?.audit || receivedAudit;
    rawResponse = rawResponse || received?.rawResponse;
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
      await this.jobs?.assertCurrent(transaction, videoId, reviewId);
      const currentReview = await transaction.aiContentReview.findUnique({ where: { id: reviewId } });
      if (!currentReview || currentReview.status !== AiReviewStatus.running) return;

      await transaction.aiContentReview.update({
        where: { id: reviewId },
        data: {
          status: AiReviewStatus.failed,
          errorMessage: message,
          rawResponse: rawResponse
            ? { rawText: sanitizeContentReviewText(rawResponse), usage: received?.usage || null, usageCollectionStatus: received?.usageCollectionStatus || 'unknown' }
            : undefined,
        },
      });
      await transaction.video.update({
        where: { id: videoId },
        data: { status: VideoStatus.ai_content_failed },
      });
      await this.operationLogsService.create({
        userId: user.id,
        videoId,
        targetType: 'ai_content_review',
        targetId: reviewId,
        actionType: OperationLogAction.AiContentReviewFailed,
        result: 'failure',
        comment: message,
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      }, transaction);
      await this.jobs?.finishCurrent(transaction, 'failed', !rawResponse &&
        !(error instanceof ContentReviewConfigurationError) && !(error instanceof ContentReviewFileProcessingError) &&
        !(error instanceof ContentReviewOutputValidationError), error);
    });
  }

  private async handleBackgroundFailure(
    reviewId: string,
    videoId: string,
    user: AuthenticatedUser,
    requestMeta: RequestMeta,
    error: unknown,
  ) {
    this.logger.error(
      'Qwen content review background task failed outside the normal processing path.',
      sanitizeContentReviewText(error instanceof Error ? error.message : String(error), 500),
    );
    try {
      await this.markFailed(reviewId, videoId, user, requestMeta, undefined, error);
    } catch (persistenceError) {
      this.logger.error(
        'Failed to persist contained Qwen content review background failure.',
        sanitizeContentReviewText(
          persistenceError instanceof Error ? persistenceError.message : String(persistenceError),
          500,
        ),
      );
    }
  }
}
