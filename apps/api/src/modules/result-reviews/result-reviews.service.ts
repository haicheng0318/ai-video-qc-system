import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  Inject,
} from '@nestjs/common';
import { AiReviewStatus, DataSufficiency, EvaluationJob, Prisma, VideoStatus } from '@prisma/client';
import { EvaluationJobsService, EvaluationLeaseLostError } from '../evaluation-jobs/evaluation-jobs.service';
import { AuthenticatedUser } from '../../types/authenticated-user';
import {
  TextModelConfigurationError,
  TextModelRefusalError,
  TextModelRequestError,
  TextModelRequestTimeoutError,
  TextModelResponseError,
  TextModelResponseAudit,
  ResultReviewOutputValidationError,
  ResultReviewSnapshotBindingError,
} from '../ai/gpt/gpt.errors';
import { RESULT_REVIEW_DEVELOPER_PROMPT, RESULT_REVIEW_PROMPT_VERSION } from '../ai/gpt/gpt-result-review.prompt';
import { ResultReviewOutput } from '../ai/gpt/gpt-result-review.schema';
import { GptService } from '../ai/gpt/gpt.service';
import { OperationLogAction } from '../operation-logs/operation-log-actions';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { ResultReviewHistoryQueryDto } from './dto/result-review-history-query.dto';
import { TriggerResultReviewDto } from './dto/trigger-result-review.dto';
import {
  BenchmarkInput,
  buildResultReviewContext,
  selectApplicableBenchmarks,
} from './result-review-context';
import { resultReviewResponse } from './result-review-response';

export const RESULT_REVIEW_BACKGROUND_SCHEDULER = Symbol('RESULT_REVIEW_BACKGROUND_SCHEDULER');
export type ResultReviewBackgroundTask = () => Promise<void>;
export type ResultReviewBackgroundScheduler = (task: ResultReviewBackgroundTask) => void;

type RequestMeta = { ipAddress?: string; userAgent?: string };
type AuditResponse = {
  usageCollectionStatus?: string;
  responseId?: string;
  responseStatus?: string;
  model?: string;
  rawText?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  parsed?: ResultReviewOutput;
  benchmarkCoverage?: string;
};

const triggerStatuses = new Set<VideoStatus>([
  VideoStatus.pending_result_data,
  VideoStatus.ai_result_failed,
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function staleMinutes() {
  const value = Number(process.env.QWEN_RESULT_REVIEW_RUNNING_STALE_MINUTES || 10);
  return Number.isFinite(value) && value > 0 ? value : 10;
}

export function sanitizeModelText(value: string | undefined, maximum = 20_000) {
  if (!value) return undefined;
  let sanitized = value;
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (apiKey) sanitized = sanitized.split(apiKey).join('[redacted]');
  sanitized = sanitized
    .replace(/Bearer\s+[^"',}\]\s]+/gi, 'Bearer [redacted]')
    .replace(/(?:postgres(?:ql)?|mysql|mongodb):\/\/[^\s"']+/gi, '[database-url]')
    .replace(/(?:\/Users|\/private|\/home)\/[^"'\s]+/g, '[path]')
    .replace(/([?&](?:token|key|secret|signature|authorization)=)[^&#\s]+/gi, '$1[redacted]');
  return sanitized.slice(0, maximum);
}

function safeFailure(error: unknown) {
  if (error instanceof TextModelConfigurationError) return { type: error.code, message: 'Qwen result review is not configured.' };
  if (error instanceof TextModelRequestTimeoutError) return { type: error.code, message: 'Qwen result review timed out.' };
  if (error instanceof TextModelRequestError) return { type: error.code, message: 'Qwen result review request failed.' };
  if (error instanceof TextModelResponseError) return { type: error.code, message: 'Qwen returned an incomplete result review.' };
  if (error instanceof TextModelRefusalError) return { type: error.code, message: 'Qwen could not complete this result review.' };
  if (error instanceof ResultReviewOutputValidationError) return { type: error.code, message: 'Qwen returned an invalid structured result.' };
  if (error instanceof ResultReviewSnapshotBindingError) return { type: error.code, message: 'Result metric snapshot changed during review.' };
  return { type: 'QWEN_RESULT_REVIEW_FAILED', message: 'Qwen result review failed.' };
}

@Injectable()
export class ResultReviewsService {
  private readonly logger = new Logger(ResultReviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionsService: PermissionsService,
    private readonly operationLogsService: OperationLogsService,
    private readonly gptService: GptService,
    @Optional() @Inject(RESULT_REVIEW_BACKGROUND_SCHEDULER)
    private readonly backgroundScheduler?: ResultReviewBackgroundScheduler,
    @Optional() private readonly jobs?: EvaluationJobsService,
  ) {}

  async trigger(
    videoId: string,
    dto: TriggerResultReviewDto,
    user: AuthenticatedUser,
    requestMeta: RequestMeta,
  ) {
    if (!this.jobs && !this.backgroundScheduler) throw new Error('Persistent evaluation queue is required.');
    if (!uuidPattern.test(videoId)) throw new NotFoundException('Video not found.');
    const video = await this.prisma.video.findUnique({ where: { id: videoId } });
    if (!video) throw new NotFoundException('Video not found.');
    await this.permissionsService.assertCanTriggerResultReview(user, video, requestMeta);

    const started = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
      const lockedVideo = await transaction.video.findUnique({ where: { id: videoId } });
      if (!lockedVideo) throw new NotFoundException('Video not found.');
      await this.jobs?.assertNoActive(transaction, videoId, 'result');

      const running = await transaction.aiResultReview.findMany({
        where: { videoId, status: AiReviewStatus.running },
        orderBy: { createdAt: 'desc' },
      });
      if (this.jobs && running.length) throw new ConflictException('Legacy evaluation is awaiting durable recovery.');
      const staleBefore = new Date(Date.now() - staleMinutes() * 60_000);
      if (running.some((review) => review.createdAt > staleBefore)) {
        throw new ConflictException('A result review is already running for this video.');
      }
      for (const stale of running) {
        await transaction.aiResultReview.update({
          where: { id: stale.id },
          data: { status: AiReviewStatus.failed, errorMessage: 'Recovered stale running result review.' },
        });
        await transaction.video.update({ where: { id: videoId }, data: { status: VideoStatus.ai_result_failed } });
        await this.operationLogsService.create({
          userId: user.id,
          videoId,
          targetType: 'ai_result_review',
          targetId: stale.id,
          actionType: OperationLogAction.AiResultReviewRecovered,
          result: 'failure',
          afterValue: { resultMetricId: stale.resultMetricId, status: AiReviewStatus.failed },
          comment: 'Recovered stale running result review.',
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        }, transaction);
      }

      const recovered = running.length > 0;
      if (!triggerStatuses.has(lockedVideo.status) &&
        !(lockedVideo.status === VideoStatus.ai_result_reviewing && recovered)) {
        throw new ConflictException('Video status does not allow result review.');
      }

      const requestedMetric = await transaction.videoResultMetric.findFirst({
        where: { id: dto.resultMetricId, videoId },
      });
      if (!requestedMetric) throw new NotFoundException('Result metric snapshot not found.');
      const latestMetric = await transaction.videoResultMetric.findFirst({
        where: { videoId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (!latestMetric) throw new NotFoundException('Result metric snapshot not found.');
      if (latestMetric.id !== dto.resultMetricId) {
        throw new ConflictException('Only the latest result metric snapshot can be reviewed.');
      }
      const succeeded = await transaction.aiResultReview.findFirst({
        where: { resultMetricId: dto.resultMetricId, status: AiReviewStatus.succeeded },
      });
      if (succeeded) {
        throw new ConflictException('This result metric snapshot has already been reviewed.');
      }

      const modelConfig = await transaction.aiModelConfig.findFirst({
        where: { enabled: true, provider: 'aliyun_bailian', agentType: 'result_review' },
        orderBy: { createdAt: 'asc' },
      });
      const modelName = modelConfig?.modelName?.trim() || process.env.QWEN_RESULT_REVIEW_MODEL?.trim() || 'qwen3.5-plus';
      const maxOutputTokens = modelConfig?.maxTokens && modelConfig.maxTokens > 0
        ? modelConfig.maxTokens
        : positiveInteger(
        process.env.QWEN_RESULT_REVIEW_MAX_OUTPUT_TOKENS,
        4000,
      );
      const review = await transaction.aiResultReview.create({
        data: {
          videoId,
          resultMetricId: dto.resultMetricId,
          modelProvider: 'aliyun_bailian',
          modelName,
          status: AiReviewStatus.running,
          dataSufficiency: DataSufficiency.pending,
        },
      });
      const originalStatus = lockedVideo.status;
      await transaction.video.update({ where: { id: videoId }, data: { status: VideoStatus.ai_result_reviewing } });
      await this.operationLogsService.create({
        userId: user.id,
        videoId,
        targetType: 'ai_result_review',
        targetId: review.id,
        actionType: OperationLogAction.AiResultReviewStarted,
        result: 'started',
        beforeValue: { videoStatus: originalStatus },
        afterValue: {
          resultMetricId: dto.resultMetricId,
          modelName,
          videoStatus: VideoStatus.ai_result_reviewing,
        },
        comment: 'Qwen result review started.',
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      }, transaction);
      let jobId: string | undefined;
      if (this.jobs) {
        const content = await transaction.aiContentReview.findFirst({ where: { videoId, status: AiReviewStatus.succeeded }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
        const supervisor = await transaction.supervisorReview.findUnique({ where: { videoId } });
        const benchmarks = lockedVideo.platform ? await transaction.platformBenchmark.findMany({ where: {
          enabled: true, platform: lockedVideo.platform, videoType: lockedVideo.videoType,
          OR: lockedVideo.brand ? [{ brand: lockedVideo.brand }, { brand: null }] : [{ brand: null }],
        } }) : [];
        const selected = selectApplicableBenchmarks(benchmarks as BenchmarkInput[], lockedVideo.brand, lockedVideo.videoType, lockedVideo.isForAds);
        const snapshot = await transaction.evaluationInputSnapshot.create({ data: {
          videoId, actorId: user.id, benchmarkIds: benchmarks.map((item) => item.id),
          data: selected as Prisma.InputJsonValue,
        } });
        const job = await this.jobs.enqueue(transaction, {
          videoId, actorId: user.id, stage: 'result', resultReviewId: review.id, maxOutputTokens,
          inputRefs: { resultMetricId: dto.resultMetricId, contentReviewId: content?.id || null,
            supervisorReviewId: supervisor?.id || null, benchmarkSnapshotId: snapshot.id },
        });
        jobId = job.id;
      }
      return { reviewId: review.id, resultMetricId: dto.resultMetricId, modelName, maxOutputTokens, jobId };
    });

    if (!this.jobs) this.runInBackground(started, user, requestMeta);
    return {
      reviewId: started.reviewId,
      resultMetricId: started.resultMetricId,
      status: AiReviewStatus.running,
      videoStatus: VideoStatus.ai_result_reviewing,
      ...(started.jobId ? { jobId: started.jobId } : {}),
    };
  }

  async executeJob(job: EvaluationJob) {
    const review = await this.prisma.aiResultReview.findUniqueOrThrow({ where: { id: job.resultReviewId! } });
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: job.actorId } });
    await this.process({ reviewId: review.id, resultMetricId: review.resultMetricId!, modelName: review.modelName,
      maxOutputTokens: job.maxOutputTokens, inputRefs: job.inputRefs as Record<string, any> }, actor, {});
  }

  private runInBackground(
    started: { reviewId: string; resultMetricId: string; modelName: string; maxOutputTokens: number },
    user: AuthenticatedUser,
    requestMeta: RequestMeta,
  ) {
    const task = async () => {
      try {
        await this.process(started, user, requestMeta);
      } catch (error) {
        await this.handleBackgroundFailure(started, user, requestMeta, error);
      }
    };
    if (this.backgroundScheduler) {
      this.backgroundScheduler(task);
      return;
    }
    throw new Error('Persistent evaluation queue is required.');
  }

  private async process(
    started: { reviewId: string; resultMetricId: string; modelName: string; maxOutputTokens: number; inputRefs?: Record<string, any> },
    user: AuthenticatedUser,
    requestMeta: RequestMeta,
  ) {
    let audit: AuditResponse = {};
    const review = await this.prisma.aiResultReview.findUnique({ where: { id: started.reviewId } });
    if (!review || review.status !== AiReviewStatus.running) return;
    const video = await this.prisma.video.findUnique({ where: { id: review.videoId } });
    if (!video) throw new ResultReviewSnapshotBindingError('Video record is unavailable.');
    const metric = await this.prisma.videoResultMetric.findFirst({
      where: { id: started.resultMetricId, videoId: video.id },
    });
    if (!metric) throw new ResultReviewSnapshotBindingError('Result metric snapshot is unavailable.');
    const contentReview = await this.prisma.aiContentReview.findFirst({
      where: { videoId: video.id, status: AiReviewStatus.succeeded, ...(started.inputRefs ? { id: started.inputRefs.contentReviewId || '00000000-0000-4000-8000-000000000000' } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    const supervisorReview = await this.prisma.supervisorReview.findUnique({ where: { videoId: video.id } });
    if (started.inputRefs && (supervisorReview?.id || null) !== started.inputRefs.supervisorReviewId) {
      throw new ResultReviewSnapshotBindingError('Supervisor source changed before review.');
    }
    const snapshot = started.inputRefs ? await this.prisma.evaluationInputSnapshot.findUnique({
      where: { id: started.inputRefs.benchmarkSnapshotId },
    }) : null;
    if (started.inputRefs && (snapshot?.videoId !== video.id || snapshot.version !== 'benchmark-v1')) {
      throw new ResultReviewSnapshotBindingError('Benchmark snapshot is unavailable.');
    }
    const benchmarkRows = !snapshot && video.platform ? await this.prisma.platformBenchmark.findMany({
      where: {
        enabled: true,
        platform: video.platform,
        videoType: video.videoType,
        OR: video.brand ? [{ brand: video.brand }, { brand: null }] : [{ brand: null }],
      },
    }) : [];
    const selected = snapshot ? snapshot.data as ReturnType<typeof selectApplicableBenchmarks> : selectApplicableBenchmarks(
      benchmarkRows as BenchmarkInput[],
      video.brand,
      video.videoType,
      video.isForAds,
    );
    if (selected.invalidDirectionCount > 0) {
      this.logger.warn(`Ignored ${selected.invalidDirectionCount} unsupported platform benchmark direction(s).`);
    }
    const inputContext = buildResultReviewContext({
      video,
      metric,
      contentReview,
      supervisorReview,
      benchmarks: selected.benchmarks,
      benchmarkCoverage: selected.benchmarkCoverage,
    });

    try {
      await this.jobs?.markExternalStarted();
      const response = await this.gptService.reviewResultData({
        model: started.modelName,
        developerPrompt: RESULT_REVIEW_DEVELOPER_PROMPT,
        inputContext,
        maxOutputTokens: started.maxOutputTokens,
      });
      audit = {
        responseId: response.responseId,
        responseStatus: response.responseStatus,
        model: response.model,
        rawText: sanitizeModelText(response.rawText),
        usage: response.usage,
        usageCollectionStatus: response.usageCollectionStatus,
        parsed: response.parsedOutput,
        benchmarkCoverage: selected.benchmarkCoverage,
      };
      await this.complete(started.reviewId, video.id, started.resultMetricId, response.parsedOutput, audit, user, requestMeta);
    } catch (error) {
      if (error instanceof EvaluationLeaseLostError) throw error;
      audit = this.auditFromError(error, selected.benchmarkCoverage) || audit;
      await this.markFailed(started.reviewId, video.id, started.resultMetricId, error, audit, user, requestMeta);
    }
  }

  private auditFromError(error: unknown, benchmarkCoverage: string): AuditResponse | null {
    const source = error && typeof error === 'object' && 'audit' in error
      ? (error as { audit?: TextModelResponseAudit }).audit
      : undefined;
    if (!source) return null;
    return {
      responseId: source.responseId,
      responseStatus: source.responseStatus,
      model: source.model,
      rawText: sanitizeModelText(source.rawText),
      usage: source.usage,
      usageCollectionStatus: source.usageCollectionStatus,
      benchmarkCoverage,
    };
  }

  private async complete(
    reviewId: string,
    videoId: string,
    resultMetricId: string,
    output: ResultReviewOutput,
    audit: AuditResponse,
    user: AuthenticatedUser,
    requestMeta: RequestMeta,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
      await this.jobs?.assertCurrent(transaction, videoId, reviewId);
      const [currentVideo, currentReview, currentMetric, latestMetric] = await Promise.all([
        transaction.video.findUnique({ where: { id: videoId } }),
        transaction.aiResultReview.findUnique({ where: { id: reviewId } }),
        transaction.videoResultMetric.findFirst({ where: { id: resultMetricId, videoId } }),
        transaction.videoResultMetric.findFirst({ where: { videoId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      ]);
      if (!currentReview || currentReview.status !== AiReviewStatus.running) return;
      if (!currentVideo || currentVideo.status !== VideoStatus.ai_result_reviewing ||
        !currentMetric || latestMetric?.id !== resultMetricId || currentReview.resultMetricId !== resultMetricId) {
        throw new ResultReviewSnapshotBindingError('Result metric binding changed during review.');
      }

      await transaction.aiResultReview.update({
        where: { id: reviewId },
        data: {
          dataScore: output.dataScore,
          dataGrade: output.dataGrade,
          dataSufficiency: output.dataSufficiency,
          isBusinessEffectiveRecommendation: output.isBusinessEffectiveRecommendation,
          resultSummary: output.resultSummary,
          performanceProblems: output.performanceProblems,
          attributionAnalysis: output.attributionAnalysis,
          optimizationSuggestions: output.optimizationSuggestions,
          rawResponse: {
            promptVersion: RESULT_REVIEW_PROMPT_VERSION,
            responseId: audit.responseId || null,
            responseStatus: audit.responseStatus || null,
            model: audit.model || currentReview.modelName,
            rawText: audit.rawText || null,
            parsed: output,
            usage: audit.usage || { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            usageCollectionStatus: audit.usageCollectionStatus || 'unknown',
            benchmarkCoverage: audit.benchmarkCoverage || 'none',
          } as Prisma.InputJsonValue,
          status: AiReviewStatus.succeeded,
          errorMessage: null,
        },
      });
      await transaction.video.update({ where: { id: videoId }, data: { status: VideoStatus.pending_rule_engine } });
      await this.operationLogsService.create({
        userId: user.id,
        videoId,
        targetType: 'ai_result_review',
        targetId: reviewId,
        actionType: OperationLogAction.AiResultReviewCompleted,
        result: 'success',
        beforeValue: { videoStatus: VideoStatus.ai_result_reviewing },
        afterValue: {
          resultMetricId,
          modelName: currentReview.modelName,
          dataSufficiency: output.dataSufficiency,
          dataScore: output.dataScore,
          dataGrade: output.dataGrade,
          videoStatus: VideoStatus.pending_rule_engine,
        },
        comment: 'Qwen result review completed.',
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      }, transaction);
      await this.jobs?.finishCurrent(transaction, 'succeeded');
    });
  }

  private async markFailed(
    reviewId: string,
    videoId: string,
    resultMetricId: string,
    error: unknown,
    audit: AuditResponse,
    user: AuthenticatedUser,
    requestMeta: RequestMeta,
  ) {
    const failure = safeFailure(error);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
      await this.jobs?.assertCurrent(transaction, videoId, reviewId);
      const currentReview = await transaction.aiResultReview.findUnique({ where: { id: reviewId } });
      const currentVideo = await transaction.video.findUnique({ where: { id: videoId } });
      if (!currentReview || currentReview.status !== AiReviewStatus.running) return;
      await transaction.aiResultReview.update({
        where: { id: reviewId },
        data: {
          status: AiReviewStatus.failed,
          errorMessage: failure.message,
          rawResponse: Object.keys(audit).length > 0 ? {
            promptVersion: RESULT_REVIEW_PROMPT_VERSION,
            responseId: audit.responseId || null,
            responseStatus: audit.responseStatus || null,
            model: audit.model || currentReview.modelName,
            rawText: audit.rawText || null,
            usage: audit.usage || null,
            usageCollectionStatus: audit.usageCollectionStatus || 'unknown',
            benchmarkCoverage: audit.benchmarkCoverage || null,
          } as Prisma.InputJsonValue : undefined,
        },
      });
      if (currentVideo?.status === VideoStatus.ai_result_reviewing) {
        await transaction.video.update({ where: { id: videoId }, data: { status: VideoStatus.ai_result_failed } });
      }
      await this.operationLogsService.create({
        userId: user.id,
        videoId,
        targetType: 'ai_result_review',
        targetId: reviewId,
        actionType: OperationLogAction.AiResultReviewFailed,
        result: 'failure',
        beforeValue: { videoStatus: currentVideo?.status || null },
        afterValue: {
          resultMetricId,
          failureType: failure.type,
          videoStatus: currentVideo?.status === VideoStatus.ai_result_reviewing
            ? VideoStatus.ai_result_failed
            : currentVideo?.status || null,
        },
        comment: failure.message,
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      }, transaction);
      await this.jobs?.finishCurrent(transaction, 'failed', error instanceof TextModelRequestTimeoutError || error instanceof TextModelRequestError, error);
    });
  }

  private async handleBackgroundFailure(
    started: { reviewId: string; resultMetricId: string },
    user: AuthenticatedUser,
    requestMeta: RequestMeta,
    error: unknown,
  ) {
    const review = await this.prisma.aiResultReview.findUnique({ where: { id: started.reviewId } }).catch(() => null);
    this.logger.error('Qwen result review background task failed outside normal processing.', {
      reviewId: started.reviewId,
      videoId: review?.videoId,
      resultMetricId: started.resultMetricId,
      errorType: safeFailure(error).type,
    });
    if (!review) return;
    try {
      await this.markFailed(review.id, review.videoId, started.resultMetricId, error, {}, user, requestMeta);
    } catch (persistenceError) {
      this.logger.error('Failed to persist contained Qwen result review failure.', {
        reviewId: started.reviewId,
        videoId: review.videoId,
        resultMetricId: started.resultMetricId,
        errorType: safeFailure(persistenceError).type,
      });
    }
  }

  async latest(videoId: string, user: AuthenticatedUser, requestMeta: RequestMeta) {
    const video = await this.findAccessibleVideo(videoId, user, requestMeta);
    const review = await this.prisma.aiResultReview.findFirst({
      where: { videoId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const job = review?.status === AiReviewStatus.running
      ? await this.prisma.evaluationJob?.findFirst({ where: { resultReviewId: review.id }, select: { id: true } })
      : null;
    return { videoStatus: video.status, review: review ? resultReviewResponse(review) : null, jobId: job?.id || null };
  }

  async byId(videoId: string, reviewId: string, user: AuthenticatedUser, requestMeta: RequestMeta) {
    const video = await this.findAccessibleVideo(videoId, user, requestMeta);
    if (!uuidPattern.test(reviewId)) throw new NotFoundException('Result review not found.');
    const review = await this.prisma.aiResultReview.findFirst({ where: { id: reviewId, videoId } });
    if (!review) throw new NotFoundException('Result review not found.');
    return { videoStatus: video.status, review: resultReviewResponse(review) };
  }

  async history(videoId: string, query: ResultReviewHistoryQueryDto, user: AuthenticatedUser, requestMeta: RequestMeta) {
    await this.findAccessibleVideo(videoId, user, requestMeta);
    const cursor = query.cursor ? await this.prisma.aiResultReview.findFirst({
      where: { id: query.cursor, videoId },
      select: { id: true, createdAt: true },
    }) : null;
    if (query.cursor && !cursor) throw new BadRequestException('Result review history cursor is invalid.');
    const limit = query.limit || 20;
    const records = await this.prisma.aiResultReview.findMany({
      where: {
        videoId,
        ...(cursor ? {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { resultMetric: { select: { dataStartDate: true, dataEndDate: true } } },
    });
    const hasMore = records.length > limit;
    const page = records.slice(0, limit);
    const latestId = await this.prisma.aiResultReview.findFirst({
      where: { videoId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    return {
      items: page.map((record) => ({
        ...resultReviewResponse(record),
        dataPeriod: {
          start: record.resultMetric?.dataStartDate?.toISOString() || null,
          end: record.resultMetric?.dataEndDate?.toISOString() || null,
        },
        isLatest: record.id === latestId?.id,
      })),
      nextCursor: hasMore ? page.at(-1)?.id || null : null,
    };
  }

  private async findAccessibleVideo(videoId: string, user: AuthenticatedUser, requestMeta: RequestMeta) {
    if (!uuidPattern.test(videoId)) throw new NotFoundException('Video not found.');
    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      include: { creator: { select: { managerId: true } } },
    });
    if (!video) throw new NotFoundException('Video not found.');
    await this.permissionsService.assertCanAccessVideo(user, video, {
      ...requestMeta,
      action: 'AI result review access denied.',
    });
    return video;
  }
}
