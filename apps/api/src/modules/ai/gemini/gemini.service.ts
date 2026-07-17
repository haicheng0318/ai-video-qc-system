import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AiReviewStatus, Prisma, VideoStatus } from '@prisma/client';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { AuthenticatedUser } from '../../../types/authenticated-user';
import { OperationLogAction } from '../../operation-logs/operation-log-actions';
import { OperationLogsService } from '../../operation-logs/operation-logs.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GeminiClient, GEMINI_CLIENT } from './gemini.client';
import {
  GeminiConfigurationError,
  GeminiFileProcessingError,
  GeminiFileProcessingTimeoutError,
  GeminiOutputValidationError,
} from './gemini.errors';
import { buildContentReviewPrompt } from './gemini.prompt';
import { ContentReviewOutput, validateContentReviewOutput } from './gemini.schema';

export const GEMINI_BACKGROUND_SCHEDULER = Symbol('GEMINI_BACKGROUND_SCHEDULER');
export type GeminiBackgroundTask = () => Promise<void>;
export type GeminiBackgroundScheduler = (task: GeminiBackgroundTask) => void;

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
    throw new GeminiFileProcessingError('Video file path is invalid.');
  }
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    throw new GeminiFileProcessingError('Video file is unavailable.');
  }
  return absolutePath;
}

function timeoutMs() {
  const value = Number(process.env.GEMINI_REQUEST_TIMEOUT_MS || 120_000);
  return Number.isInteger(value) && value > 0 ? value : 120_000;
}

function runningStaleMinutes() {
  const value = Number(process.env.GEMINI_RUNNING_STALE_MINUTES || 10);
  return Number.isFinite(value) && value > 0 ? value : 10;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function sanitizeGeminiText(value: string | undefined, maxLength?: number) {
  if (!value) return undefined;
  const configuredKey = process.env.GEMINI_API_KEY?.trim();
  let sanitized = value;
  if (configuredKey) {
    sanitized = sanitized.split(configuredKey).join('[redacted]');
  }
  sanitized = sanitized
    .replace(/Bearer\s+[^"',}\]\s]+/gi, 'Bearer [redacted]')
    .replace(/(?:\/Users|\/private|\/home)\/[^"'\s]+/g, '[path]');
  return maxLength ? sanitized.slice(0, maxLength) : sanitized;
}

function sanitizeOutput(output: ContentReviewOutput) {
  const sanitized = sanitizeGeminiText(JSON.stringify(output));
  if (!sanitized) throw new GeminiOutputValidationError('Gemini content review output was empty.');
  return validateContentReviewOutput(JSON.parse(sanitized));
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(
      () => rejectPromise(new GeminiFileProcessingTimeoutError('Gemini request timed out.')),
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
  if (error instanceof GeminiConfigurationError) return 'Gemini content review is not configured.';
  if (error instanceof GeminiOutputValidationError) return 'Gemini returned an invalid structured result.';
  if (error instanceof GeminiFileProcessingTimeoutError) return 'Gemini video processing timed out.';
  if (error instanceof GeminiFileProcessingError) return 'Gemini video processing failed.';
  return 'Gemini content review failed.';
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionsService: PermissionsService,
    private readonly operationLogsService: OperationLogsService,
    @Inject(GEMINI_CLIENT) private readonly geminiClient: GeminiClient,
    @Optional() @Inject(GEMINI_BACKGROUND_SCHEDULER)
    private readonly backgroundScheduler?: GeminiBackgroundScheduler,
  ) {}

  async triggerContentReview(
    videoId: string,
    user: AuthenticatedUser,
    requestMeta: RequestMeta,
  ) {
    if (!isUuid(videoId)) throw new NotFoundException('Video not found.');
    const video = await this.prisma.video.findUnique({ where: { id: videoId } });
    if (!video) throw new NotFoundException('Video not found.');
    await this.permissionsService.assertCanTriggerContentReview(user, video, requestMeta);

    const started = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
      const currentVideo = await transaction.video.findUnique({ where: { id: videoId } });
      if (!currentVideo) throw new NotFoundException('Video not found.');

      const runningReviews = await transaction.aiContentReview.findMany({
        where: { videoId, status: AiReviewStatus.running },
        orderBy: { createdAt: 'desc' },
      });
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
          provider: 'gemini',
          agentType: { in: ['content_review', 'video_content_review'] },
        },
        orderBy: { createdAt: 'asc' },
      });
      const modelName = modelConfig?.modelName || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      const review = await transaction.aiContentReview.create({
        data: {
          videoId,
          modelProvider: 'gemini',
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
        comment: 'Gemini content review started.',
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      }, transaction);
      return { reviewId: review.id, modelName };
    });

    this.runContentReviewInBackground(started.reviewId, videoId, started.modelName, user, requestMeta);
    return { reviewId: started.reviewId, status: AiReviewStatus.running };
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

    setImmediate(() => {
      void task().catch((error) => {
        this.logger.error(
          'Unhandled Gemini background task failure was contained.',
          sanitizeGeminiText(error instanceof Error ? error.message : String(error), 500),
        );
      });
    });
  }

  private async processContentReview(
    reviewId: string,
    videoId: string,
    modelName: string,
    user: AuthenticatedUser,
    requestMeta: RequestMeta,
  ) {
    let rawResponse: string | undefined;
    try {
      const review = await this.prisma.aiContentReview.findUnique({ where: { id: reviewId } });
      if (!review || review.status !== AiReviewStatus.running) return;
      const video = await this.prisma.video.findUnique({ where: { id: videoId } });
      if (!video) throw new GeminiFileProcessingError('Video record is unavailable.');

      const videoPath = safeVideoPath(video.filePath);
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
      const result = await withTimeout(
        this.geminiClient.analyzeVideo(videoPath, video.mimeType, modelName, prompt),
        timeoutMs(),
      );
      rawResponse = result.rawResponse;
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawResponse);
      } catch {
        throw new GeminiOutputValidationError('Gemini content review response was not valid JSON.');
      }
      const output = sanitizeOutput(validateContentReviewOutput(parsed));
      const sanitizedRawText = sanitizeGeminiText(rawResponse);
      if (!sanitizedRawText) throw new GeminiOutputValidationError('Gemini content review response was empty.');

      await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
        const currentReview = await transaction.aiContentReview.findUnique({ where: { id: reviewId } });
        if (!currentReview || currentReview.status !== AiReviewStatus.running) return;

        await transaction.aiContentReview.update({
          where: { id: reviewId },
          data: {
            contentSummary: output.contentSummary,
            totalScore: output.totalScore,
            contentGrade: output.contentGrade,
            isPublishableRecommendation: output.isPublishableRecommendation,
            mainProblems: output.mainProblems,
            revisionSuggestions: output.revisionSuggestions,
            complianceRisks: output.complianceRisks,
            usableScenarios: output.usableScenarios,
            rawResponse: {
              rawText: sanitizedRawText,
              parsed: output,
            },
            status: AiReviewStatus.succeeded,
            errorMessage: null,
          },
        });
        await transaction.contentReviewScore.createMany({
          data: output.scores.map((score) => ({
            aiContentReviewId: reviewId,
            dimension: score.dimension,
            score: score.score,
            maxScore: score.maxScore,
            comment: score.comment,
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
          comment: 'Gemini content review completed.',
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        }, transaction);
      });
    } catch (error) {
      await this.markFailed(reviewId, videoId, user, requestMeta, rawResponse, error);
    }
  }

  async latest(videoId: string, user: AuthenticatedUser, requestMeta: RequestMeta) {
    if (!isUuid(videoId)) throw new NotFoundException('Video not found.');
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
      where: { videoId },
      orderBy: { createdAt: 'desc' },
      include: { scores: true },
    });
    await this.operationLogsService.create({
      userId: user.id,
      videoId,
      targetType: 'video',
      targetId: videoId,
      actionType: OperationLogAction.AiContentReviewViewed,
      result: 'success',
      comment: 'Latest Gemini content review viewed.',
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
  ) {
    const message = failureMessage(error);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
      const currentReview = await transaction.aiContentReview.findUnique({ where: { id: reviewId } });
      if (!currentReview || currentReview.status !== AiReviewStatus.running) return;

      await transaction.aiContentReview.update({
        where: { id: reviewId },
        data: {
          status: AiReviewStatus.failed,
          errorMessage: message,
          rawResponse: rawResponse
            ? { rawText: sanitizeGeminiText(rawResponse) }
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
      'Gemini background task failed outside the normal processing path.',
      sanitizeGeminiText(error instanceof Error ? error.message : String(error), 500),
    );
    try {
      await this.markFailed(reviewId, videoId, user, requestMeta, undefined, error);
    } catch (persistenceError) {
      this.logger.error(
        'Failed to persist contained Gemini background task failure.',
        sanitizeGeminiText(
          persistenceError instanceof Error ? persistenceError.message : String(persistenceError),
          500,
        ),
      );
    }
  }
}
