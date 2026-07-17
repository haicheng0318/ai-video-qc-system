import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AiReviewStatus, Prisma, VideoStatus } from '@prisma/client';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { OperationLogAction } from '../operation-logs/operation-log-actions';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateSupervisorReviewDto,
  SupervisorReviewDecision,
} from './dto/create-supervisor-review.dto';

type RequestMeta = { ipAddress?: string; userAgent?: string };

const decisionStatus: Record<SupervisorReviewDecision, VideoStatus> = {
  [SupervisorReviewDecision.ApprovedForPublish]: VideoStatus.approved_for_publish,
  [SupervisorReviewDecision.RevisionRequired]: VideoStatus.revision_required,
  [SupervisorReviewDecision.InvalidContent]: VideoStatus.invalid_content,
};

const decisionAction: Record<SupervisorReviewDecision, string> = {
  [SupervisorReviewDecision.ApprovedForPublish]: OperationLogAction.SupervisorReviewApproved,
  [SupervisorReviewDecision.RevisionRequired]: OperationLogAction.SupervisorReviewRevisionRequired,
  [SupervisorReviewDecision.InvalidContent]: OperationLogAction.SupervisorReviewInvalidContent,
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

@Injectable()
export class SupervisorReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionsService: PermissionsService,
    private readonly operationLogsService: OperationLogsService,
  ) {}

  async create(
    videoId: string,
    dto: CreateSupervisorReviewDto,
    user: AuthenticatedUser,
    requestMeta: RequestMeta,
  ) {
    this.validateRequiredReason(dto);
    const video = await this.findVideo(videoId);
    await this.permissionsService.assertCanSubmitSupervisorReview(user, video, requestMeta);

    try {
      const review = await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
        const lockedVideo = await transaction.video.findUnique({
          where: { id: videoId },
          include: { creator: { select: { managerId: true } } },
        });
        if (!lockedVideo) throw new NotFoundException('Video not found.');

        if (lockedVideo.status !== VideoStatus.pending_supervisor_review) {
          throw new ConflictException('Video status does not allow supervisor review.');
        }
        const existingReview = await transaction.supervisorReview.findUnique({ where: { videoId } });
        if (existingReview) throw new ConflictException('This video has already been reviewed.');

        const succeededContentReview = await transaction.aiContentReview.findFirst({
          where: { videoId, status: AiReviewStatus.succeeded },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        if (!succeededContentReview) {
          throw new ConflictException('A successful Gemini content review is required.');
        }

        const created = await transaction.supervisorReview.create({
          data: {
            videoId,
            reviewerId: user.id,
            decision: dto.decision,
            isAllowedToPublish: dto.decision === SupervisorReviewDecision.ApprovedForPublish,
            comment: dto.comment?.trim() || null,
            revisionRequirements: this.cleanRequirements(dto.revisionRequirements),
            reviewedAt: new Date(),
          },
          include: {
            reviewer: { select: { id: true, name: true, account: true, role: true } },
          },
        });

        await transaction.video.update({
          where: { id: videoId },
          data: { status: decisionStatus[dto.decision] },
        });
        await this.operationLogsService.create({
          userId: user.id,
          videoId,
          targetType: 'supervisor_review',
          targetId: created.id,
          actionType: decisionAction[dto.decision],
          result: 'success',
          afterValue: {
            decision: dto.decision,
            comment: dto.comment?.trim() || null,
          },
          comment: 'Supervisor review submitted.',
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        }, transaction);

        return created;
      });
      return this.toResponse(review);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This video has already been reviewed.');
      }
      throw error;
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
      action: 'Supervisor review access denied.',
    });
    const review = await this.prisma.supervisorReview.findUnique({
      where: { videoId },
      include: { reviewer: { select: { id: true, name: true, account: true, role: true } } },
    });
    await this.operationLogsService.create({
      userId: user.id,
      videoId,
      targetType: review ? 'supervisor_review' : 'video',
      targetId: review?.id || videoId,
      actionType: OperationLogAction.SupervisorReviewViewed,
      result: 'success',
      comment: 'Latest supervisor review viewed.',
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });
    return review ? this.toResponse(review) : null;
  }

  private async findVideo(videoId: string) {
    if (!isUuid(videoId)) throw new NotFoundException('Video not found.');
    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      include: { creator: { select: { managerId: true } } },
    });
    if (!video) throw new NotFoundException('Video not found.');
    return video;
  }

  private validateRequiredReason(dto: CreateSupervisorReviewDto) {
    if (
      (dto.decision === SupervisorReviewDecision.RevisionRequired ||
        dto.decision === SupervisorReviewDecision.InvalidContent) &&
      !dto.comment?.trim()
    ) {
      throw new BadRequestException(
        dto.decision === SupervisorReviewDecision.RevisionRequired
          ? 'Revision comment is required.'
          : 'Invalid content reason is required.',
      );
    }
  }

  private cleanRequirements(requirements?: string[]) {
    const cleaned = requirements?.map((item) => item.trim()).filter(Boolean) || [];
    return cleaned.length > 0 ? cleaned : Prisma.JsonNull;
  }

  private toResponse(review: {
    id: string;
    videoId: string;
    decision: string;
    comment: string | null;
    revisionRequirements: Prisma.JsonValue | null;
    reviewedAt: Date;
    reviewer: { id: string; name: string; account: string; role: string };
  }) {
    return {
      id: review.id,
      videoId: review.videoId,
      decision: review.decision,
      comment: review.comment,
      revisionRequirements: Array.isArray(review.revisionRequirements)
        ? review.revisionRequirements.filter((item): item is string => typeof item === 'string')
        : [],
      reviewedAt: review.reviewedAt,
      reviewer: review.reviewer,
    };
  }
}
