import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AiReviewStatus, DataSufficiency, Prisma, VideoStatus } from '@prisma/client';
import { FINAL_EVALUATION_VERSION, RecommendedBoundary, recommendedBoundaries } from '@ai-video-qc/shared';
import { AuthenticatedUser } from '../../types/authenticated-user';
import {
  FinalEvaluationOutputValidationError,
  FinalEvaluationSourceBindingError,
  OpenAiConfigurationError,
  OpenAiRefusalError,
  OpenAiRequestError,
  OpenAiRequestTimeoutError,
  OpenAiResponseAudit,
  OpenAiResponseError,
} from '../ai/gpt/gpt.errors';
import { FINAL_EVALUATION_DEVELOPER_PROMPT } from '../ai/gpt/gpt-final-evaluation.prompt';
import { FinalEvaluationOutput } from '../ai/gpt/gpt-final-evaluation.schema';
import { GptService } from '../ai/gpt/gpt.service';
import { OperationLogAction } from '../operation-logs/operation-log-actions';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { evaluateRuleBoundary, RuleEngineInputError } from '../rule-engine/rule-engine.rules';
import { FinalEvaluationHistoryQueryDto } from './dto/final-evaluation-history-query.dto';
import { TriggerFinalEvaluationDto } from './dto/trigger-final-evaluation.dto';
import { buildFinalEvaluationContext } from './final-evaluation-context';
import { finalEvaluationHistoryResponse, finalEvaluationResponse } from './final-evaluation-response';

export const FINAL_EVALUATION_BACKGROUND_SCHEDULER = Symbol('FINAL_EVALUATION_BACKGROUND_SCHEDULER');
export type FinalEvaluationBackgroundTask = () => Promise<void>;
export type FinalEvaluationBackgroundScheduler = (task: FinalEvaluationBackgroundTask) => void;

type RequestMeta = { ipAddress?: string; userAgent?: string };
type StartedEvaluation = {
  evaluationId: string;
  videoId: string;
  ruleEngineResultId: string;
  modelName: string;
  maxOutputTokens: number;
};
type AuditResponse = {
  responseId?: string;
  responseStatus?: string;
  model?: string;
  rawText?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  parsed?: FinalEvaluationOutput;
  recommendedBoundary?: string;
};

const triggerStatuses = new Set<VideoStatus>([VideoStatus.pending_final_evaluation, VideoStatus.final_evaluation_failed]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function staleMinutes() {
  const parsed = Number(process.env.OPENAI_FINAL_EVALUATION_RUNNING_STALE_MINUTES || 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

export function sanitizeFinalEvaluationText(value: string | undefined, maximum = 20_000) {
  if (!value) return undefined;
  let sanitized = value;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (apiKey) sanitized = sanitized.split(apiKey).join('[redacted]');
  return sanitized
    .replace(/Bearer\s+[^"',}\]\s]+/gi, 'Bearer [redacted]')
    .replace(/(?:postgres(?:ql)?|mysql|mongodb):\/\/[^\s"']+/gi, '[database-url]')
    .replace(/(?:\/Users|\/private|\/home)\/[^"'\s]+/g, '[path]')
    .replace(/([?&](?:token|key|secret|signature|authorization)=)[^&#\s]+/gi, '$1[redacted]')
    .slice(0, maximum);
}

function safeFailure(error: unknown) {
  if (error instanceof OpenAiConfigurationError) return { type: error.code, message: 'OpenAI final evaluation is not configured.' };
  if (error instanceof OpenAiRequestTimeoutError) return { type: error.code, message: 'OpenAI final evaluation timed out.' };
  if (error instanceof OpenAiRequestError) return { type: error.code, message: 'OpenAI final evaluation request failed.' };
  if (error instanceof OpenAiResponseError) return { type: error.code, message: 'OpenAI returned an incomplete final evaluation.' };
  if (error instanceof OpenAiRefusalError) return { type: error.code, message: 'OpenAI could not complete this final evaluation.' };
  if (error instanceof FinalEvaluationOutputValidationError) return { type: error.code, message: 'OpenAI returned an invalid final evaluation suggestion.' };
  if (error instanceof FinalEvaluationSourceBindingError) return { type: error.code, message: 'Final evaluation sources changed during processing.' };
  return { type: 'FINAL_EVALUATION_FAILED', message: 'GPT final evaluation failed.' };
}

@Injectable()
export class FinalEvaluationsService {
  private readonly logger = new Logger(FinalEvaluationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly operationLogs: OperationLogsService,
    private readonly gpt: GptService,
    @Optional() @Inject(FINAL_EVALUATION_BACKGROUND_SCHEDULER)
    private readonly scheduler?: FinalEvaluationBackgroundScheduler,
  ) {}

  async trigger(videoId: string, dto: TriggerFinalEvaluationDto, user: AuthenticatedUser, meta: RequestMeta) {
    if (!uuidPattern.test(videoId)) throw new NotFoundException('Video not found.');
    const video = await this.prisma.video.findUnique({ where: { id: videoId } });
    if (!video) throw new NotFoundException('Video not found.');
    await this.permissions.assertCanTriggerFinalEvaluation(user, video, meta);

    const started = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
      const lockedVideo = await transaction.video.findUnique({ where: { id: videoId } });
      if (!lockedVideo) throw new NotFoundException('Video not found.');
      await this.permissions.assertCanTriggerFinalEvaluation(user, lockedVideo, meta);

      const running = await transaction.finalVideoEvaluation.findMany({
        where: { videoId, status: AiReviewStatus.running },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const staleBefore = new Date(Date.now() - staleMinutes() * 60_000);
      if (running.some((evaluation) => evaluation.createdAt > staleBefore)) {
        throw new ConflictException('A final evaluation is already running for this video.');
      }
      for (const stale of running) {
        await transaction.finalVideoEvaluation.update({
          where: { id: stale.id },
          data: {
            status: AiReviewStatus.failed,
            errorMessage: 'Recovered stale running final evaluation.',
            completedAt: new Date(),
            successKey: null,
          },
        });
        await this.operationLogs.create({
          userId: user.id, videoId, targetType: 'final_video_evaluation', targetId: stale.id,
          actionType: OperationLogAction.FinalEvaluationRecovered, result: 'failure',
          afterValue: { status: AiReviewStatus.failed, staleMinutes: staleMinutes() },
          comment: 'Recovered stale running final evaluation.',
          ipAddress: meta.ipAddress, userAgent: meta.userAgent,
        }, transaction);
      }

      if (!triggerStatuses.has(lockedVideo.status)) {
        throw new ConflictException('Video status does not allow final evaluation.');
      }
      const sources = await this.loadSources(transaction, videoId, dto.ruleEngineResultId);
      this.assertSources(sources, dto.ruleEngineResultId);

      const succeeded = await transaction.finalVideoEvaluation.findFirst({
        where: {
          ruleEngineResultId: dto.ruleEngineResultId,
          evaluationVersion: FINAL_EVALUATION_VERSION,
          status: AiReviewStatus.succeeded,
        },
      });
      if (succeeded) throw new ConflictException('This rule result already has a succeeded final evaluation.');

      const modelConfig = await transaction.aiModelConfig.findFirst({
        where: { enabled: true, provider: 'openai', agentType: 'final_evaluation' },
        orderBy: { createdAt: 'asc' },
      });
      const modelName = modelConfig?.modelName?.trim() ||
        process.env.OPENAI_FINAL_EVALUATION_MODEL?.trim() || 'gpt-5-mini';
      const maxOutputTokens = modelConfig?.maxTokens && modelConfig.maxTokens > 0
        ? modelConfig.maxTokens
        : positiveInteger(process.env.OPENAI_FINAL_EVALUATION_MAX_OUTPUT_TOKENS, 4000);
      const evaluation = await transaction.finalVideoEvaluation.create({
        data: {
          videoId,
          contentReviewId: sources.contentReview.id,
          resultReviewId: sources.resultReview.id,
          ruleEngineResultId: sources.ruleResult.id,
          evaluationVersion: FINAL_EVALUATION_VERSION,
          status: AiReviewStatus.running,
          triggeredById: user.id,
          modelProvider: 'openai',
          modelName,
          contentGrade: sources.ruleResult.contentGrade!,
          dataGrade: sources.ruleResult.dataGrade!,
        },
      });
      const originalStatus = lockedVideo.status;
      if (lockedVideo.status === VideoStatus.final_evaluation_failed) {
        await transaction.video.update({ where: { id: videoId }, data: { status: VideoStatus.pending_final_evaluation } });
      }
      await this.operationLogs.create({
        userId: user.id, videoId, targetType: 'final_video_evaluation', targetId: evaluation.id,
        actionType: OperationLogAction.FinalEvaluationStarted, result: 'started',
        beforeValue: { videoStatus: originalStatus },
        afterValue: {
          videoStatus: VideoStatus.pending_final_evaluation,
          contentReviewId: sources.contentReview.id,
          resultReviewId: sources.resultReview.id,
          ruleEngineResultId: sources.ruleResult.id,
          evaluationVersion: FINAL_EVALUATION_VERSION,
          modelName,
        },
        comment: 'GPT final evaluation suggestion started.',
        ipAddress: meta.ipAddress, userAgent: meta.userAgent,
      }, transaction);
      return {
        evaluationId: evaluation.id, videoId, ruleEngineResultId: sources.ruleResult.id,
        modelName, maxOutputTokens,
      };
    });

    this.runInBackground(started, user, meta);
    return {
      evaluationId: started.evaluationId,
      ruleEngineResultId: started.ruleEngineResultId,
      status: AiReviewStatus.running,
      videoStatus: VideoStatus.pending_final_evaluation,
    };
  }

  private runInBackground(started: StartedEvaluation, user: AuthenticatedUser, meta: RequestMeta) {
    const task = async () => {
      try {
        await this.process(started, user, meta);
      } catch (error) {
        try {
          await this.markFailed(started, error, {}, user, meta);
        } catch (persistenceError) {
          this.logger.error('Failed to persist contained final evaluation background failure.', {
            evaluationId: started.evaluationId,
            errorType: safeFailure(persistenceError).type,
          });
        }
      }
    };
    if (this.scheduler) return this.scheduler(task);
    setImmediate(() => {
      void task().catch((error) => this.logger.error('Unhandled final evaluation failure was contained.', {
        evaluationId: started.evaluationId,
        errorType: safeFailure(error).type,
      }));
    });
  }

  private async process(started: StartedEvaluation, user: AuthenticatedUser, meta: RequestMeta) {
    const evaluation = await this.prisma.finalVideoEvaluation.findUnique({ where: { id: started.evaluationId } });
    if (!evaluation || evaluation.status !== AiReviewStatus.running) return;
    let audit: AuditResponse = {};
    try {
      const sources = await this.loadSources(this.prisma, started.videoId, started.ruleEngineResultId);
      this.assertSources(sources, started.ruleEngineResultId, true);
      const boundary = sources.ruleResult.recommendedBoundary as RecommendedBoundary;
      const context = buildFinalEvaluationContext({
        video: sources.video,
        supervisorReview: sources.supervisorReview,
        contentReview: sources.contentReview,
        metric: sources.metric,
        resultReview: sources.resultReview,
        ruleResult: sources.ruleResult,
      });
      const response = await this.gpt.generateFinalEvaluation({
        model: started.modelName,
        developerPrompt: FINAL_EVALUATION_DEVELOPER_PROMPT,
        inputContext: context,
        maxOutputTokens: started.maxOutputTokens,
        recommendedBoundary: boundary,
      });
      audit = {
        responseId: response.responseId,
        responseStatus: response.responseStatus,
        model: response.model,
        rawText: sanitizeFinalEvaluationText(response.rawText),
        usage: response.usage,
        parsed: response.parsedOutput,
        recommendedBoundary: boundary,
      };
      await this.complete(started, response.parsedOutput, audit, user, meta);
    } catch (error) {
      audit = this.auditFromError(error, audit);
      await this.markFailed(started, error, audit, user, meta);
    }
  }

  private auditFromError(error: unknown, fallback: AuditResponse): AuditResponse {
    const source = error && typeof error === 'object' && 'audit' in error
      ? (error as { audit?: OpenAiResponseAudit }).audit
      : undefined;
    if (!source) return fallback;
    return {
      responseId: source.responseId,
      responseStatus: source.responseStatus,
      model: source.model,
      rawText: sanitizeFinalEvaluationText(source.rawText),
      usage: source.usage,
      recommendedBoundary: fallback.recommendedBoundary,
    };
  }

  private async complete(
    started: StartedEvaluation,
    output: FinalEvaluationOutput,
    audit: AuditResponse,
    user: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${started.videoId}::uuid FOR UPDATE`);
      const evaluation = await transaction.finalVideoEvaluation.findUnique({ where: { id: started.evaluationId } });
      if (!evaluation || evaluation.status !== AiReviewStatus.running) return;
      const sources = await this.loadSources(transaction, started.videoId, started.ruleEngineResultId);
      this.assertSources(sources, started.ruleEngineResultId, true);
      if (sources.video.status !== VideoStatus.pending_final_evaluation ||
        evaluation.contentReviewId !== sources.contentReview.id ||
        evaluation.resultReviewId !== sources.resultReview.id ||
        evaluation.ruleEngineResultId !== sources.ruleResult.id) {
        throw new FinalEvaluationSourceBindingError('Final evaluation source binding changed.');
      }
      const successKey = `${sources.ruleResult.id}:${FINAL_EVALUATION_VERSION}`;
      await transaction.finalVideoEvaluation.update({
        where: { id: started.evaluationId },
        data: {
          recommendedFinalGrade: output.recommendedFinalGrade,
          recommendedFinalStatus: output.recommendedFinalStatus,
          recommendedIsEffective: output.recommendedIsEffective,
          recommendationConfidence: output.recommendationConfidence,
          decisionSummary: output.decisionSummary,
          evidenceAssessment: output.evidenceAssessment,
          finalAttribution: output.finalAttribution,
          finalSuggestion: output.finalSuggestion,
          confirmationFocus: output.confirmationFocus,
          riskFlags: output.riskFlags,
          rawResponse: {
            promptVersion: FINAL_EVALUATION_VERSION,
            responseId: audit.responseId || null,
            responseStatus: audit.responseStatus || null,
            model: audit.model || evaluation.modelName,
            rawText: audit.rawText || null,
            parsed: output,
            usage: audit.usage || { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            ruleEngineResultId: sources.ruleResult.id,
            recommendedBoundary: sources.ruleResult.recommendedBoundary,
          } as Prisma.InputJsonValue,
          status: AiReviewStatus.succeeded,
          errorMessage: null,
          completedAt: new Date(),
          successKey,
        },
      });
      await transaction.video.update({
        where: { id: started.videoId },
        data: { status: VideoStatus.pending_final_confirmation },
      });
      await this.operationLogs.create({
        userId: user.id, videoId: started.videoId,
        targetType: 'final_video_evaluation', targetId: started.evaluationId,
        actionType: OperationLogAction.FinalEvaluationCompleted, result: 'success',
        beforeValue: { videoStatus: VideoStatus.pending_final_evaluation },
        afterValue: {
          videoStatus: VideoStatus.pending_final_confirmation,
          contentReviewId: sources.contentReview.id,
          resultReviewId: sources.resultReview.id,
          ruleEngineResultId: sources.ruleResult.id,
          recommendedBoundary: sources.ruleResult.recommendedBoundary,
          recommendedFinalGrade: output.recommendedFinalGrade,
          recommendedFinalStatus: output.recommendedFinalStatus,
          recommendedIsEffective: output.recommendedIsEffective,
          recommendationConfidence: output.recommendationConfidence,
        },
        comment: 'GPT final evaluation suggestion completed; owner confirmation is pending.',
        ipAddress: meta.ipAddress, userAgent: meta.userAgent,
      }, transaction);
    });
  }

  private async markFailed(
    started: StartedEvaluation,
    error: unknown,
    audit: AuditResponse,
    user: AuthenticatedUser,
    meta: RequestMeta,
  ) {
    const failure = safeFailure(error);
    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${started.videoId}::uuid FOR UPDATE`);
        const evaluation = await transaction.finalVideoEvaluation.findUnique({ where: { id: started.evaluationId } });
        if (!evaluation || evaluation.status !== AiReviewStatus.running) return;
        await transaction.finalVideoEvaluation.update({
          where: { id: started.evaluationId },
          data: {
            status: AiReviewStatus.failed,
            errorMessage: failure.message,
            completedAt: new Date(),
            successKey: null,
            rawResponse: Object.keys(audit).length ? {
              promptVersion: FINAL_EVALUATION_VERSION,
              responseId: audit.responseId || null,
              responseStatus: audit.responseStatus || null,
              model: audit.model || evaluation.modelName,
              rawText: audit.rawText || null,
              usage: audit.usage || null,
              ruleEngineResultId: started.ruleEngineResultId,
              recommendedBoundary: audit.recommendedBoundary || null,
            } as Prisma.InputJsonValue : undefined,
          },
        });
        const currentVideo = await transaction.video.findUnique({ where: { id: started.videoId } });
        if (currentVideo?.status === VideoStatus.pending_final_evaluation) {
          await transaction.video.update({
            where: { id: started.videoId },
            data: { status: VideoStatus.final_evaluation_failed },
          });
        }
        await this.operationLogs.create({
          userId: user.id, videoId: started.videoId,
          targetType: 'final_video_evaluation', targetId: started.evaluationId,
          actionType: OperationLogAction.FinalEvaluationFailed, result: 'failure',
          beforeValue: { videoStatus: currentVideo?.status || null },
          afterValue: {
            videoStatus: VideoStatus.final_evaluation_failed,
            contentReviewId: evaluation.contentReviewId,
            resultReviewId: evaluation.resultReviewId,
            ruleEngineResultId: evaluation.ruleEngineResultId,
            errorType: failure.type,
          },
          comment: failure.message,
          ipAddress: meta.ipAddress, userAgent: meta.userAgent,
        }, transaction);
      });
    } catch (persistenceError) {
      if (persistenceError instanceof Prisma.PrismaClientKnownRequestError && persistenceError.code === 'P2002') {
        throw new ConflictException('A succeeded final evaluation already exists for this rule result.');
      }
      throw persistenceError;
    }
  }

  async latest(videoId: string, user: AuthenticatedUser, meta: RequestMeta) {
    const video = await this.findAccessibleVideo(videoId, user, meta);
    const evaluation = await this.prisma.finalVideoEvaluation.findFirst({
      where: { videoId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { confirmer: { select: { id: true, name: true, account: true, role: true } } },
    });
    return { videoStatus: video.status, evaluation: evaluation ? finalEvaluationResponse(evaluation) : null };
  }

  async history(videoId: string, query: FinalEvaluationHistoryQueryDto, user: AuthenticatedUser, meta: RequestMeta) {
    await this.findAccessibleVideo(videoId, user, meta);
    const cursor = query.cursor ? await this.prisma.finalVideoEvaluation.findFirst({
      where: { id: query.cursor, videoId }, select: { id: true, createdAt: true },
    }) : null;
    if (query.cursor && !cursor) throw new BadRequestException('Final evaluation history cursor is invalid.');
    const records = await this.prisma.finalVideoEvaluation.findMany({
      where: {
        videoId,
        ...(cursor ? { OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: { confirmer: { select: { id: true, name: true, account: true, role: true } } },
    });
    const hasMore = records.length > query.limit;
    const page = records.slice(0, query.limit);
    const latest = await this.prisma.finalVideoEvaluation.findFirst({
      where: { videoId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true },
    });
    return {
      items: page.map((item) => finalEvaluationHistoryResponse(item, item.id === latest?.id)),
      nextCursor: hasMore ? page.at(-1)?.id || null : null,
    };
  }

  private async findAccessibleVideo(videoId: string, user: AuthenticatedUser, meta: RequestMeta) {
    if (!uuidPattern.test(videoId)) throw new NotFoundException('Video not found.');
    const video = await this.prisma.video.findUnique({
      where: { id: videoId }, include: { creator: { select: { managerId: true } } },
    });
    if (!video) throw new NotFoundException('Video not found.');
    await this.permissions.assertCanAccessVideo(user, video, {
      ...meta, action: 'Final evaluation suggestion access denied.',
    });
    return video;
  }

  private async loadSources(client: any, videoId: string, ruleEngineResultId: string) {
    const [video, supervisorReview, ruleResult, latestRule, latestResultReview, latestMetric] = await Promise.all([
      client.video.findUnique({ where: { id: videoId } }),
      client.supervisorReview.findUnique({ where: { videoId } }),
      client.ruleEngineResult.findFirst({ where: { id: ruleEngineResultId, videoId } }),
      client.ruleEngineResult.findFirst({ where: { videoId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      client.aiResultReview.findFirst({ where: { videoId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      client.videoResultMetric.findFirst({ where: { videoId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    ]);
    if (!video) throw new NotFoundException('Video not found.');
    if (!ruleResult) throw new NotFoundException('Rule engine result not found.');
    const [contentReview, resultReview] = await Promise.all([
      client.aiContentReview.findFirst({ where: { id: ruleResult.contentReviewId, videoId } }),
      client.aiResultReview.findFirst({ where: { id: ruleResult.resultReviewId, videoId } }),
    ]);
    const metric = resultReview?.resultMetricId
      ? await client.videoResultMetric.findFirst({ where: { id: resultReview.resultMetricId, videoId } })
      : null;
    return { video, supervisorReview, ruleResult, latestRule, contentReview, resultReview, latestResultReview, metric, latestMetric };
  }

  private assertSources(sources: any, expectedRuleId: string, background = false) {
    const fail = (message: string, kind: 'notFound' | 'conflict' | 'invalid' = 'invalid'): never => {
      if (background) throw new FinalEvaluationSourceBindingError(message);
      if (kind === 'notFound') throw new NotFoundException(message);
      if (kind === 'conflict') throw new ConflictException(message);
      throw new UnprocessableEntityException(message);
    };
    if (sources.latestRule?.id !== expectedRuleId) fail('Only the latest rule result can be evaluated.', 'conflict');
    if (!sources.supervisorReview) fail('Approved supervisor review not found.', 'notFound');
    if (sources.supervisorReview.decision !== VideoStatus.approved_for_publish || sources.supervisorReview.isAllowedToPublish === false) {
      fail('Supervisor review does not allow publication.');
    }
    if (!sources.contentReview || sources.contentReview.status !== AiReviewStatus.succeeded) {
      fail('Succeeded content review not found.', 'notFound');
    }
    if (!sources.resultReview || sources.resultReview.status !== AiReviewStatus.succeeded) {
      fail('Succeeded result review not found.', 'notFound');
    }
    if (!sources.metric || !sources.resultReview.resultMetricId) fail('Bound result metric not found.', 'notFound');
    if (sources.latestMetric?.id !== sources.metric.id || sources.latestResultReview?.id !== sources.resultReview.id) {
      fail('Final evaluation sources are no longer current.', 'conflict');
    }
    const rule = sources.ruleResult;
    if (rule.ruleVersion !== 'rule-engine-v1' || rule.dataSufficiency !== DataSufficiency.sufficient ||
      !rule.contentReviewId || !rule.resultReviewId || !rule.dataGrade ||
      !(recommendedBoundaries as readonly string[]).includes(rule.recommendedBoundary) ||
      rule.recommendedBoundary === 'pending_data') {
      fail('Rule engine result is not eligible for final evaluation.');
    }
    if (sources.contentReview.id !== rule.contentReviewId || sources.contentReview.contentGrade !== rule.contentGrade ||
      sources.resultReview.id !== rule.resultReviewId || sources.resultReview.dataGrade !== rule.dataGrade ||
      sources.resultReview.dataSufficiency !== rule.dataSufficiency) {
      fail('Rule engine source grades are inconsistent.');
    }
    try {
      const expected = evaluateRuleBoundary({
        contentGrade: rule.contentGrade,
        dataGrade: rule.dataGrade,
        dataSufficiency: rule.dataSufficiency,
      });
      for (const key of ['contentGrade', 'dataGrade', 'dataSufficiency', 'ruleCode', 'ruleResult', 'recommendedBoundary'] as const) {
        if (expected[key] !== rule[key]) fail('Stored rule result failed deterministic integrity review.');
      }
    } catch (error) {
      if (error instanceof RuleEngineInputError) fail('Stored rule grades are invalid.');
      throw error;
    }
  }
}
