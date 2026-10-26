import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, UserRole, Video, VideoRecordState } from '@prisma/client';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { OperationLogAction } from '../operation-logs/operation-log-actions';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { PrismaService } from '../prisma/prisma.service';

export function canManageResultData(user: AuthenticatedUser, video: Video) {
  return user.role === UserRole.admin || video.creatorId === user.id;
}

@Injectable()
export class PermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsService,
  ) {}

  buildVideoVisibilityWhere(user: AuthenticatedUser) {
    if (user.role === UserRole.admin) {
      return {};
    }
    return { creatorId: user.id, recordState: VideoRecordState.active };
  }

  async assertCanAccessVideo(
    user: AuthenticatedUser,
    video: Video & { creator?: { managerId: string | null } },
    requestMeta?: { ipAddress?: string; userAgent?: string; action?: string },
  ) {
    const allowed = user.role === UserRole.admin
      ? true
      : video.creatorId === user.id && video.recordState === VideoRecordState.active;

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
    this.assertVideoActive(video);
    const allowed =
      user.role === UserRole.admin || video.creatorId === user.id;

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
    this.assertVideoActive(video);
    const allowed =
      user.role === UserRole.admin ||
      (user.role === UserRole.supervisor &&
        video.creatorId === user.id) ||
      (user.role === UserRole.content_owner && video.creatorId === user.id);

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
    this.assertVideoActive(video);
    const allowed =
      video.creatorId === user.id || user.role === UserRole.admin;

    if (!allowed) {
      await this.logVideoPermissionDenied(user, video.id, 'Video revision upload denied.', requestMeta);
      throw new ForbiddenException('You do not have permission to upload a revision for this video.');
    }
  }

  async assertCanSubmitResultMetrics(
    user: AuthenticatedUser,
    video: Video,
    requestMeta?: { ipAddress?: string; userAgent?: string },
  ) {
    this.assertVideoActive(video);
    if (!canManageResultData(user, video)) {
      await this.logVideoPermissionDenied(
        user,
        video.id,
        'Result metric submission denied.',
        requestMeta,
      );
      throw new ForbiddenException('You do not have permission to submit result metrics.');
    }
  }

  assertVideoActive(video: Pick<Video, 'recordState'>) {
    if (video.recordState !== VideoRecordState.active) {
      throw new ForbiddenException('该视频已隐藏或移入回收站，不能执行此操作。');
    }
  }

  async assertDataStageOpen(videoId: string, db: PrismaService | Prisma.TransactionClient = this.prisma) {
    const workflow = await db.v11WorkflowRevision.findFirst({
      where: { videoId, status: 'current' },
      orderBy: { revision: 'desc' },
      include: {
        holds: { where: { status: 'active' }, select: { id: true } },
        appeals: { where: { status: 'active' }, select: { id: true } },
        gateDecisions: { where: { stage: 'content' }, select: { decision: true } },
      },
    });
    if (!workflow) return;
    if (workflow.holds.length || workflow.appeals.length || !workflow.activeContentDecisionId) {
      throw new ConflictException('内容评估仍有待处理事项，暂不能进入数据阶段。');
    }
    if (workflow.gateDecisions[0]?.decision !== 'approved') {
      throw new ConflictException('内容评估尚未通过正式关卡，暂不能进入数据阶段。');
    }
    const decision = await db.v11EvaluationDecision.findUnique({
      where: { id: workflow.activeContentDecisionId },
      select: { complianceStatus: true, inputComplete: true, stable: true },
    });
    if (!decision?.inputComplete || !decision.stable || decision.complianceStatus !== 'clear') {
      throw new ConflictException('内容评估尚未通过安全与完整性关卡，暂不能进入数据阶段。');
    }
  }

  async assertCanTriggerResultReview(
    user: AuthenticatedUser,
    video: Video,
    requestMeta?: { ipAddress?: string; userAgent?: string },
  ) {
    this.assertVideoActive(video);
    if (!canManageResultData(user, video)) {
      await this.logVideoPermissionDenied(
        user,
        video.id,
        'AI result review trigger denied.',
        requestMeta,
      );
      throw new ForbiddenException('You do not have permission to trigger result review.');
    }
  }

  async assertCanExecuteRuleEngine(
    user: AuthenticatedUser,
    video: Video,
    requestMeta?: { ipAddress?: string; userAgent?: string },
  ) {
    this.assertVideoActive(video);
    const allowed = user.role === UserRole.admin || video.creatorId === user.id;
    if (!allowed) {
      await this.logVideoPermissionDenied(user, video.id, 'Rule engine execution denied.', requestMeta);
      throw new ForbiddenException('You do not have permission to execute the rule engine.');
    }
  }

  async assertCanTriggerFinalEvaluation(
    user: AuthenticatedUser,
    video: Video,
    requestMeta?: { ipAddress?: string; userAgent?: string },
  ) {
    this.assertVideoActive(video);
    const allowed = user.role === UserRole.admin || video.creatorId === user.id;
    if (!allowed) {
      await this.logVideoPermissionDenied(user, video.id, 'AI final evaluation trigger denied.', requestMeta);
      throw new ForbiddenException('You do not have permission to trigger final evaluation.');
    }
  }

  async assertCanConfirmFinalEvaluation(
    user: AuthenticatedUser,
    video: Video,
    requestMeta?: { ipAddress?: string; userAgent?: string },
  ) {
    this.assertVideoActive(video);
    const allowed = user.role === UserRole.admin || (user.role === UserRole.content_owner && video.creatorId === user.id);
    if (!allowed) {
      await this.logVideoPermissionDenied(user, video.id, 'Final confirmation denied.', requestMeta);
      throw new ForbiddenException('You do not have permission to confirm the final evaluation.');
    }
  }

  async assertCanMarkCase(
    user: AuthenticatedUser,
    video: Video,
    requestMeta?: { ipAddress?: string; userAgent?: string },
  ) {
    this.assertVideoActive(video);
    const allowed = user.role === UserRole.admin || (user.role === UserRole.content_owner && video.creatorId === user.id);
    if (!allowed) {
      await this.logVideoPermissionDenied(user, video.id, 'Case marking denied.', requestMeta);
      throw new ForbiddenException('You do not have permission to mark this case.');
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
