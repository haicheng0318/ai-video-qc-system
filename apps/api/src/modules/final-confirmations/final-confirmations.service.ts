import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AiReviewStatus, DataSufficiency, Prisma, VideoStatus } from '@prisma/client';
import {
  allowedFinalGrades,
  deriveFinalStatus,
  deriveIsEffectiveFinal,
  FinalGrade,
  finalGrades,
  isAdjustment,
  RecommendedBoundary,
  recommendedBoundaries,
} from '@ai-video-qc/shared';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { OperationLogAction } from '../operation-logs/operation-log-actions';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { evaluateRuleBoundary, RuleEngineInputError } from '../rule-engine/rule-engine.rules';
import { CreateFinalConfirmationDto } from './dto/create-final-confirmation.dto';

type RequestMeta = { ipAddress?: string; userAgent?: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const htmlPattern = /<\/?[a-z][^>]*>/i;

function clean(value: string | undefined) {
  const result = value?.trim();
  return result || undefined;
}

function assertSafeText(value: string | undefined, label: string) {
  if (value && htmlPattern.test(value)) throw new BadRequestException(`${label} must not contain HTML.`);
}

@Injectable()
export class FinalConfirmationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly operationLogs: OperationLogsService,
  ) {}

  async confirm(videoId: string, dto: CreateFinalConfirmationDto, user: AuthenticatedUser, meta: RequestMeta) {
    if (!uuidPattern.test(videoId)) throw new NotFoundException('Video not found.');
    const video = await this.prisma.video.findUnique({ where: { id: videoId } });
    if (!video) throw new NotFoundException('Video not found.');
    await this.permissions.assertCanConfirmFinalEvaluation(user, video, meta);

    const confirmationComment = clean(dto.confirmationComment);
    const manualAdjustReason = clean(dto.manualAdjustReason);
    assertSafeText(confirmationComment, 'Confirmation comment');
    assertSafeText(manualAdjustReason, 'Manual adjustment reason');

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
      const lockedVideo = await transaction.video.findUnique({ where: { id: videoId } });
      if (!lockedVideo) throw new NotFoundException('Video not found.');
      await this.permissions.assertCanConfirmFinalEvaluation(user, lockedVideo, meta);
      if (lockedVideo.status !== VideoStatus.pending_final_confirmation) {
        throw new ConflictException('Video status does not allow final confirmation.');
      }

      const evaluation = await transaction.finalVideoEvaluation.findFirst({
        where: { id: dto.evaluationId, videoId },
      });
      if (!evaluation) throw new NotFoundException('Final evaluation not found.');
      const latestEvaluation = await transaction.finalVideoEvaluation.findFirst({
        where: { videoId, status: AiReviewStatus.succeeded }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true },
      });
      if (latestEvaluation?.id !== evaluation.id || evaluation.status !== AiReviewStatus.succeeded) {
        throw new ConflictException('Only the latest succeeded final evaluation can be confirmed.');
      }
      if (evaluation.confirmedAt || evaluation.confirmedBy || evaluation.finalGrade || evaluation.finalStatus || evaluation.isEffectiveFinal !== null) {
        throw new ConflictException('Final evaluation has already been confirmed.');
      }

      const [rule, latestRule, contentReview, resultReview, latestResultReview, latestMetric, supervisorReview] = await Promise.all([
        transaction.ruleEngineResult.findFirst({ where: { id: evaluation.ruleEngineResultId, videoId } }),
        transaction.ruleEngineResult.findFirst({ where: { videoId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
        transaction.aiContentReview.findFirst({ where: { id: evaluation.contentReviewId, videoId } }),
        transaction.aiResultReview.findFirst({ where: { id: evaluation.resultReviewId, videoId } }),
        transaction.aiResultReview.findFirst({ where: { videoId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
        transaction.videoResultMetric.findFirst({ where: { videoId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
        transaction.supervisorReview.findUnique({ where: { videoId } }),
      ]);
      if (!rule || !contentReview || !resultReview || !supervisorReview) {
        throw new ConflictException('Final confirmation sources are incomplete.');
      }
      const metric = resultReview.resultMetricId
        ? await transaction.videoResultMetric.findFirst({ where: { id: resultReview.resultMetricId, videoId } })
        : null;
      if (latestRule?.id !== rule.id || latestResultReview?.id !== resultReview.id || latestMetric?.id !== metric?.id ||
        contentReview.status !== AiReviewStatus.succeeded || resultReview.status !== AiReviewStatus.succeeded ||
        supervisorReview.decision !== VideoStatus.approved_for_publish || supervisorReview.isAllowedToPublish === false ||
        evaluation.contentReviewId !== rule.contentReviewId || evaluation.resultReviewId !== rule.resultReviewId ||
        evaluation.contentGrade !== rule.contentGrade || evaluation.dataGrade !== rule.dataGrade ||
        contentReview.contentGrade !== rule.contentGrade || resultReview.dataGrade !== rule.dataGrade ||
        resultReview.dataSufficiency !== rule.dataSufficiency) {
        throw new ConflictException('Final confirmation sources are no longer current.');
      }
      if (rule.ruleVersion !== 'rule-engine-v1' || rule.dataSufficiency !== DataSufficiency.sufficient || !rule.dataGrade ||
        !(recommendedBoundaries as readonly string[]).includes(rule.recommendedBoundary) ||
        rule.recommendedBoundary === 'pending_data') {
        throw new ConflictException('Rule boundary does not allow final confirmation.');
      }
      try {
        const expected = evaluateRuleBoundary({
          contentGrade: rule.contentGrade,
          dataGrade: rule.dataGrade,
          dataSufficiency: rule.dataSufficiency,
        });
        for (const key of ['ruleCode', 'ruleResult', 'recommendedBoundary'] as const) {
          if (expected[key] !== rule[key]) throw new ConflictException('Stored rule result failed integrity review.');
        }
      } catch (error) {
        if (error instanceof RuleEngineInputError) throw new ConflictException('Stored rule result is invalid.');
        throw error;
      }

      const boundary = rule.recommendedBoundary as RecommendedBoundary;
      if (!evaluation.recommendedFinalGrade || !(finalGrades as readonly string[]).includes(evaluation.recommendedFinalGrade) ||
        !allowedFinalGrades(boundary).includes(evaluation.recommendedFinalGrade as FinalGrade)) {
        throw new ConflictException('GPT final recommendation is missing or outside the rule engine boundary.');
      }
      if (!allowedFinalGrades(boundary).includes(dto.finalGrade)) {
        throw new UnprocessableEntityException('Final grade is outside the rule engine boundary.');
      }
      const adjusted = isAdjustment(dto.finalGrade, evaluation.recommendedFinalGrade as FinalGrade);
      if (adjusted && (!manualAdjustReason || manualAdjustReason.length < 10)) {
        throw new BadRequestException('Manual adjustment reason must contain at least 10 characters.');
      }
      if (!adjusted && manualAdjustReason) {
        throw new BadRequestException('Manual adjustment reason must be omitted when accepting the GPT recommendation.');
      }
      if (boundary === 'require_manual_confirmation' && (!confirmationComment || confirmationComment.length < 10)) {
        throw new BadRequestException('Confirmation comment must contain at least 10 characters for manual confirmation.');
      }
      if (dto.finalGrade === 'invalid' && dto.canBeUsedForPerformance) {
        throw new BadRequestException('Invalid videos cannot be used for performance reference.');
      }

      const finalGrade = dto.finalGrade as FinalGrade;
      const finalStatus = deriveFinalStatus(finalGrade);
      const isEffectiveFinal = deriveIsEffectiveFinal(finalGrade);
      const confirmedAt = new Date();
      const updated = await transaction.finalVideoEvaluation.update({
        where: { id: evaluation.id },
        data: {
          finalGrade,
          finalStatus,
          isEffectiveFinal,
          canBeUsedForPerformance: dto.canBeUsedForPerformance,
          confirmedBy: user.id,
          confirmedAt,
          manualAdjustReason: adjusted ? manualAdjustReason : null,
          confirmationComment: confirmationComment || null,
        },
        include: { confirmer: { select: { id: true, name: true, account: true, role: true } } },
      });
      await transaction.video.update({ where: { id: videoId }, data: { status: finalStatus } });
      await this.operationLogs.create({
        userId: user.id, videoId, targetType: 'final_video_evaluation', targetId: evaluation.id,
        actionType: OperationLogAction.FinalEvaluationConfirmed, result: 'success',
        beforeValue: {
          videoStatus: lockedVideo.status,
          recommendedFinalGrade: evaluation.recommendedFinalGrade,
          recommendedFinalStatus: evaluation.recommendedFinalStatus,
          recommendedIsEffective: evaluation.recommendedIsEffective,
          ruleEngineResultId: rule.id,
          recommendedBoundary: boundary,
        },
        afterValue: {
          videoStatus: finalStatus, finalGrade, finalStatus, isEffectiveFinal,
          canBeUsedForPerformance: dto.canBeUsedForPerformance,
          confirmedBy: user.id,
          confirmedAt: confirmedAt.toISOString(),
        },
        comment: 'Final evaluation confirmed by an authorized owner.',
        ipAddress: meta.ipAddress, userAgent: meta.userAgent,
      }, transaction);
      if (adjusted) {
        await this.operationLogs.create({
          userId: user.id, videoId, targetType: 'final_video_evaluation', targetId: evaluation.id,
          actionType: OperationLogAction.FinalGradeAdjusted, result: 'success',
          beforeValue: { recommendedFinalGrade: evaluation.recommendedFinalGrade },
          afterValue: { finalGrade, manualAdjustReason },
          comment: 'Final grade adjusted within the deterministic rule boundary.',
          ipAddress: meta.ipAddress, userAgent: meta.userAgent,
        }, transaction);
      }
      return {
        evaluationId: updated.id,
        videoId,
        finalGrade: updated.finalGrade,
        finalStatus: updated.finalStatus,
        isEffectiveFinal: updated.isEffectiveFinal,
        canBeUsedForPerformance: updated.canBeUsedForPerformance,
        confirmedBy: updated.confirmer,
        confirmedAt: updated.confirmedAt?.toISOString() || null,
        manualAdjustReason: updated.manualAdjustReason,
        confirmationComment: updated.confirmationComment,
        videoStatus: finalStatus,
      };
    });
  }
}
