import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AiReviewStatus, Prisma, VideoStatus } from '@prisma/client';
import { RULE_ENGINE_VERSION } from '@ai-video-qc/shared';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { OperationLogAction } from '../operation-logs/operation-log-actions';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExecuteRuleEngineDto } from './dto/execute-rule-engine.dto';
import { RuleEngineHistoryQueryDto } from './dto/rule-engine-history-query.dto';
import { evaluateRuleBoundary, RuleEngineInputError } from './rule-engine.rules';
import { ruleEngineResultResponse } from './rule-engine-response';

type RequestMeta = { ipAddress?: string; userAgent?: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class RuleEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionsService: PermissionsService,
    private readonly operationLogsService: OperationLogsService,
  ) {}

  async execute(videoId: string, dto: ExecuteRuleEngineDto, user: AuthenticatedUser, requestMeta: RequestMeta) {
    if (!uuidPattern.test(videoId)) throw new NotFoundException('Video not found.');
    const video = await this.prisma.video.findUnique({ where: { id: videoId } });
    if (!video) throw new NotFoundException('Video not found.');
    await this.permissionsService.assertCanExecuteRuleEngine(user, video, requestMeta);

    try {
      const executed = await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
        const lockedVideo = await transaction.video.findUnique({ where: { id: videoId } });
        if (!lockedVideo) throw new NotFoundException('Video not found.');
        if (lockedVideo.status !== VideoStatus.pending_rule_engine) {
          throw new ConflictException('Video status does not allow rule engine execution.');
        }

        const supervisorReview = await transaction.supervisorReview.findUnique({ where: { videoId } });
        if (!supervisorReview) throw new NotFoundException('Supervisor review not found.');
        if (supervisorReview.decision !== VideoStatus.approved_for_publish || supervisorReview.isAllowedToPublish === false) {
          throw new ConflictException('Supervisor review does not allow publication.');
        }

        const contentReview = await transaction.aiContentReview.findFirst({
          where: {
            videoId,
            status: AiReviewStatus.succeeded,
            createdAt: { lte: supervisorReview.reviewedAt },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        if (!contentReview) throw new NotFoundException('Succeeded content review not found.');

        const requestedResultReview = await transaction.aiResultReview.findUnique({ where: { id: dto.resultReviewId } });
        if (!requestedResultReview || requestedResultReview.videoId !== videoId) {
          throw new NotFoundException('Result review not found.');
        }
        const latestResultReview = await transaction.aiResultReview.findFirst({
          where: { videoId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        if (!latestResultReview || latestResultReview.id !== requestedResultReview.id) {
          throw new ConflictException('Only the latest result review can be evaluated.');
        }
        if (requestedResultReview.status !== AiReviewStatus.succeeded) {
          throw new ConflictException('Result review must be succeeded.');
        }
        if (!requestedResultReview.resultMetricId) {
          throw new UnprocessableEntityException('Result review is missing its metric binding.');
        }

        const boundMetric = await transaction.videoResultMetric.findFirst({
          where: { id: requestedResultReview.resultMetricId, videoId },
        });
        if (!boundMetric) throw new NotFoundException('Bound result metric snapshot not found.');
        const latestMetric = await transaction.videoResultMetric.findFirst({
          where: { videoId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        if (!latestMetric || latestMetric.id !== boundMetric.id) {
          throw new ConflictException('Result review is not bound to the latest metric snapshot.');
        }

        const duplicate = await transaction.ruleEngineResult.findUnique({
          where: {
            resultReviewId_ruleVersion: {
              resultReviewId: requestedResultReview.id,
              ruleVersion: RULE_ENGINE_VERSION,
            },
          },
        });
        if (duplicate) throw new ConflictException('This result review already has a rule-engine-v1 result.');

        let boundary;
        try {
          boundary = evaluateRuleBoundary({
            contentGrade: contentReview.contentGrade,
            dataGrade: requestedResultReview.dataGrade,
            dataSufficiency: requestedResultReview.dataSufficiency,
          });
        } catch (error) {
          if (error instanceof RuleEngineInputError) throw new UnprocessableEntityException(error.message);
          throw error;
        }

        const nextStatus = boundary.dataSufficiency === 'insufficient'
          ? VideoStatus.pending_data
          : VideoStatus.pending_final_evaluation;
        const result = await transaction.ruleEngineResult.create({
          data: {
            videoId,
            contentReviewId: contentReview.id,
            resultReviewId: requestedResultReview.id,
            ruleVersion: RULE_ENGINE_VERSION,
            contentGrade: boundary.contentGrade,
            dataGrade: boundary.dataGrade,
            dataSufficiency: boundary.dataSufficiency,
            ruleCode: boundary.ruleCode,
            ruleResult: boundary.ruleResult,
            ruleReason: boundary.ruleReason,
            recommendedBoundary: boundary.recommendedBoundary,
          },
        });
        await transaction.video.update({ where: { id: videoId }, data: { status: nextStatus } });
        await this.operationLogsService.create({
          userId: user.id,
          videoId,
          targetType: 'rule_engine_result',
          targetId: result.id,
          actionType: OperationLogAction.RuleEngineExecuted,
          result: 'success',
          beforeValue: {
            videoStatus: VideoStatus.pending_rule_engine,
            contentReviewId: contentReview.id,
            resultReviewId: requestedResultReview.id,
            ruleVersion: RULE_ENGINE_VERSION,
          },
          afterValue: {
            videoStatus: nextStatus,
            ruleEngineResultId: result.id,
            contentGrade: boundary.contentGrade,
            dataGrade: boundary.dataGrade,
            dataSufficiency: boundary.dataSufficiency,
            ruleCode: boundary.ruleCode,
            ruleResult: boundary.ruleResult,
            recommendedBoundary: boundary.recommendedBoundary,
          },
          comment: 'Deterministic backend rule engine executed.',
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        }, transaction);
        return { result, nextStatus };
      });

      return {
        videoStatus: executed.nextStatus,
        ruleEngineResult: ruleEngineResultResponse(executed.result),
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This result review already has a rule-engine-v1 result.');
      }
      throw error;
    }
  }

  async latest(videoId: string, user: AuthenticatedUser, requestMeta: RequestMeta) {
    const video = await this.findAccessibleVideo(videoId, user, requestMeta);
    const result = await this.prisma.ruleEngineResult.findFirst({
      where: { videoId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return {
      videoStatus: video.status,
      ruleEngineResult: result ? ruleEngineResultResponse(result) : null,
    };
  }

  async history(videoId: string, query: RuleEngineHistoryQueryDto, user: AuthenticatedUser, requestMeta: RequestMeta) {
    await this.findAccessibleVideo(videoId, user, requestMeta);
    const cursor = query.cursor ? await this.prisma.ruleEngineResult.findFirst({
      where: { id: query.cursor, videoId },
      select: { id: true, createdAt: true },
    }) : null;
    if (query.cursor && !cursor) throw new BadRequestException('Rule engine history cursor is invalid.');
    const limit = query.limit || 20;
    const records = await this.prisma.ruleEngineResult.findMany({
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
    });
    const hasMore = records.length > limit;
    const page = records.slice(0, limit);
    const latest = await this.prisma.ruleEngineResult.findFirst({
      where: { videoId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    return {
      items: page.map((result) => ({
        ...ruleEngineResultResponse(result),
        isLatest: result.id === latest?.id,
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
      action: 'Rule engine result access denied.',
    });
    return video;
  }
}
