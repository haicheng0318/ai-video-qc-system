import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole, Video } from '@prisma/client';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { OperationLogAction } from '../operation-logs/operation-log-actions';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { PrismaService } from '../prisma/prisma.service';

const fullDataAccessRoles: UserRole[] = [
  UserRole.admin,
  UserRole.content_owner,
  UserRole.operator,
  UserRole.advertiser,
];

@Injectable()
export class PermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsService,
  ) {}

  buildVideoVisibilityWhere(user: AuthenticatedUser) {
    if (fullDataAccessRoles.includes(user.role)) {
      return {};
    }

    if (user.role === UserRole.supervisor) {
      return {
        OR: [
          { creatorId: user.id },
          {
            creator: {
              managerId: user.id,
            },
          },
        ],
      };
    }

    return { creatorId: user.id };
  }

  async assertCanAccessVideo(
    user: AuthenticatedUser,
    video: Video & { creator?: { managerId: string | null } },
    requestMeta?: { ipAddress?: string; userAgent?: string; action?: string },
  ) {
    const allowed =
      fullDataAccessRoles.includes(user.role) ||
      video.creatorId === user.id ||
      (user.role === UserRole.supervisor && video.creator?.managerId === user.id);

    if (!allowed) {
      await this.operationLogsService.create({
        userId: user.id,
        videoId: video.id,
        targetType: 'video',
        targetId: video.id,
        actionType: OperationLogAction.PermissionDenied,
        result: 'denied',
        comment: requestMeta?.action || 'Video access denied.',
        ipAddress: requestMeta?.ipAddress,
        userAgent: requestMeta?.userAgent,
      });
      throw new ForbiddenException('You do not have permission to access this video.');
    }
  }

  async assertCanTriggerContentReview(
    user: AuthenticatedUser,
    video: Video,
    requestMeta?: { ipAddress?: string; userAgent?: string },
  ) {
    const allowed =
      user.role === UserRole.admin ||
      user.role === UserRole.content_owner ||
      (user.role === UserRole.director && video.creatorId === user.id);

    if (!allowed) {
      await this.operationLogsService.create({
        userId: user.id,
        videoId: video.id,
        targetType: 'video',
        targetId: video.id,
        actionType: OperationLogAction.PermissionDenied,
        result: 'denied',
        comment: 'Content review trigger denied.',
        ipAddress: requestMeta?.ipAddress,
        userAgent: requestMeta?.userAgent,
      });
      throw new ForbiddenException('You do not have permission to trigger content review.');
    }
  }

  async assertCanSubmitSupervisorReview(
    user: AuthenticatedUser,
    video: Video & { creator?: { managerId: string | null } },
    requestMeta?: { ipAddress?: string; userAgent?: string },
  ) {
    const allowed =
      user.role === UserRole.admin ||
      user.role === UserRole.content_owner ||
      (user.role === UserRole.supervisor &&
        (video.creatorId === user.id || video.creator?.managerId === user.id));

    if (!allowed) {
      await this.logVideoPermissionDenied(user, video.id, 'Supervisor review submission denied.', requestMeta);
      throw new ForbiddenException('You do not have permission to review this video.');
    }
  }

  async assertCanUploadRevision(
    user: AuthenticatedUser,
    video: Video,
    requestMeta?: { ipAddress?: string; userAgent?: string },
  ) {
    const allowed =
      video.creatorId === user.id ||
      user.role === UserRole.admin ||
      user.role === UserRole.content_owner;

    if (!allowed) {
      await this.logVideoPermissionDenied(user, video.id, 'Video revision upload denied.', requestMeta);
      throw new ForbiddenException('You do not have permission to upload a revision for this video.');
    }
  }

  async findVideoVisibleToUser(videoId: string, user: AuthenticatedUser) {
    const video = await this.prisma.video.findFirst({
      where: {
        id: videoId,
        ...this.buildVideoVisibilityWhere(user),
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            account: true,
            role: true,
            managerId: true,
          },
        },
      },
    });

    return video;
  }

  private async logVideoPermissionDenied(
    user: AuthenticatedUser,
    videoId: string,
    comment: string,
    requestMeta?: { ipAddress?: string; userAgent?: string },
  ) {
    await this.operationLogsService.create({
      userId: user.id,
      videoId,
      targetType: 'video',
      targetId: videoId,
      actionType: OperationLogAction.PermissionDenied,
      result: 'denied',
      comment,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });
  }
}
