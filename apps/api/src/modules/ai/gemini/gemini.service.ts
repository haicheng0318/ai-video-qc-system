import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
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
import { validateContentReviewOutput } from './gemini.schema';

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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeText(value: string | undefined) {
  if (!value) return undefined;
  const configuredKey = process.env.GEMINI_API_KEY?.trim();
  return value
    .replace(configuredKey || '__no_gemini_key__', '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(?:\/Users|\/private|\/home)\/\S+/g, '[path]')
    .slice(0, 1000);
}

function safeRawResponse(value: string | undefined) {
  if (!value) return undefined;
  return safeText(value)?.slice(0, 10_000);
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new GeminiFileProcessingTimeoutError('Gemini request timed out.')), milliseconds);
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

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionsService: PermissionsService,
    private readonly operationLogsService: OperationLogsService,
    @Inject(GEMINI_CLIENT) private readonly geminiClient: GeminiClient,
  ) {}

  async reviewVideo(
    videoId: string,
    user: AuthenticatedUser,
    requestMeta: { ipAddress?: string; userAgent?: string },
  ) {
    if (!isUuid(videoId)) throw new NotFoundException('Video not found.');
    const video = await this.prisma.video.findUnique({ where: { id: videoId } });
    if (!video) throw new NotFoundException('Video not found.');
    await this.permissionsService.assertCanTriggerContentReview(user, video, requestMeta);

    const started = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
      const currentVideo = await transaction.video.findUnique({ where: { id: videoId } });
      if (!currentVideo) throw new NotFoundException('Video not found.');

      const runningReview = await transaction.aiContentReview.findFirst({
        where: { videoId, status: AiReviewStatus.running },
      });
      if (runningReview || currentVideo.status === VideoStatus.ai_content_reviewing) {
        throw new ConflictException('A content review is already running for this video.');
      }
      if (currentVideo.status !== VideoStatus.submitted && currentVideo.status !== VideoStatus.ai_content_failed) {
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
      await transaction.video.update({ where: { id: videoId }, data: { status: VideoStatus.ai_content_reviewing } });
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
      return { reviewId: review.id, modelName, video: currentVideo };
    });

    let rawResponse: string | undefined;
    try {
      const videoPath = safeVideoPath(started.video.filePath);
      const prompt = buildContentReviewPrompt({
        platform: started.video.platform,
        videoType: started.video.videoType,
        brand: started.video.brand,
        product: started.video.product,
        isForAds: started.video.isForAds,
        isEventVideo: started.video.isEventVideo,
        eventName: started.video.eventName,
        scriptDescription: started.video.scriptDescription,
        relatedRequirement: started.video.relatedRequirement,
      });
      const result = await withTimeout(
        this.geminiClient.analyzeVideo(videoPath, started.video.mimeType, started.modelName, prompt),
        timeoutMs(),
      );
      rawResponse = result.rawResponse;
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawResponse);
      } catch {
        throw new GeminiOutputValidationError('Gemini content review response was not valid JSON.');
      }
      const output = validateContentReviewOutput(parsed);

      await this.prisma.$transaction(async (transaction) => {
        await transaction.aiContentReview.update({
          where: { id: started.reviewId },
          data: {
            contentSummary: output.contentSummary,
            totalScore: output.totalScore,
            contentGrade: output.contentGrade,
            isPublishableRecommendation: output.isPublishableRecommendation,
            mainProblems: output.mainProblems,
            revisionSuggestions: output.revisionSuggestions,
            complianceRisks: output.complianceRisks,
            usableScenarios: output.usableScenarios,
            rawResponse: output,
            status: AiReviewStatus.succeeded,
            errorMessage: null,
          },
        });
        await transaction.contentReviewScore.createMany({
          data: output.scores.map((score) => ({
            aiContentReviewId: started.reviewId,
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
          targetId: started.reviewId,
          actionType: OperationLogAction.AiContentReviewCompleted,
          result: 'success',
          comment: 'Gemini content review completed.',
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        }, transaction);
      });

      return { reviewId: started.reviewId, status: AiReviewStatus.succeeded, videoStatus: VideoStatus.pending_supervisor_review };
    } catch (error) {
      await this.markFailed(started.reviewId, videoId, user, requestMeta, rawResponse, error);
      if (error instanceof GeminiConfigurationError) {
        throw new ServiceUnavailableException('Gemini content review is not configured.');
      }
      if (error instanceof ConflictException || error instanceof NotFoundException) throw error;
      throw new BadGatewayException('Gemini content review failed.');
    }
  }

  async latest(
    videoId: string,
    user: AuthenticatedUser,
    requestMeta: { ipAddress?: string; userAgent?: string },
  ) {
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
    requestMeta: { ipAddress?: string; userAgent?: string },
    rawResponse: string | undefined,
    error: unknown,
  ) {
    const message = error instanceof GeminiOutputValidationError
      ? 'Gemini returned an invalid structured result.'
      : error instanceof GeminiFileProcessingTimeoutError
        ? 'Gemini video processing timed out.'
        : error instanceof GeminiFileProcessingError
          ? 'Gemini video processing failed.'
          : 'Gemini content review failed.';
    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.aiContentReview.update({
          where: { id: reviewId },
          data: {
            status: AiReviewStatus.failed,
            errorMessage: message,
            rawResponse: safeRawResponse(rawResponse),
          },
        });
        await transaction.video.update({ where: { id: videoId }, data: { status: VideoStatus.ai_content_failed } });
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
    } catch (markFailedError) {
      this.logger.error('Failed to persist Gemini content review failure state.', markFailedError instanceof Error ? markFailedError.message : undefined);
    }
  }
}
