import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { OperationLogAction } from '../operation-logs/operation-log-actions';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupervisorReviewDto } from './dto/create-supervisor-review.dto';

type RequestMeta = { ipAddress?: string; userAgent?: string };

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
    _videoId: string,
    _dto: CreateSupervisorReviewDto,
    _user: AuthenticatedUser,
    _requestMeta: RequestMeta,
  ) {
    throw new ConflictException('当前版本已取消日常人工内容审核。');
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

  private toResponse(review: {
    id: string;
    videoId: string;
    v11ContentDecisionId: string | null;
    decision: string;
    comment: string | null;
    revisionRequirements: Prisma.JsonValue | null;
    reviewedAt: Date;
    reviewer: { id: string; name: string; account: string; role: string };
  }) {
    return {
      id: review.id,
      videoId: review.videoId,
      v11ContentDecisionId: review.v11ContentDecisionId,
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
