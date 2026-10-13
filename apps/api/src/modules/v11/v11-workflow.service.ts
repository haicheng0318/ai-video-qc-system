import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { EvaluationJobsService } from '../evaluation-jobs/evaluation-jobs.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateV11AppealDto } from './dto/create-v11-appeal.dto';

@Injectable()
export class V11WorkflowService {
  constructor(private readonly db: PrismaService, private readonly permissions: PermissionsService, private readonly jobs: EvaluationJobsService) {}

  async appeal(videoId: string, dto: CreateV11AppealDto, user: AuthenticatedUser) {
    const reason = dto.reason.trim();
    if (reason.length < 10 || reason.length > 500) throw new BadRequestException('Appeal reason must contain 10 to 500 characters.');
    const video = await this.permissions.findVideoVisibleToUser(videoId, user);
    if (!video) throw new NotFoundException('Video not found.');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
      const decision = await tx.v11EvaluationDecision.findUnique({ where: { id: dto.resultId }, include: { group: true, workflowRevision: true } });
      if (!decision || decision.group.videoId !== videoId || dto.stage !== 'content') throw new NotFoundException('Appealable result not found.');
      if (decision.workflowRevision.status !== 'current') throw new ConflictException('This result has already been superseded.');
      if (await tx.v11Appeal.findFirst({ where: { resultId: dto.resultId, status: 'active' } })) throw new ConflictException('An active appeal already exists for this result.');
      if (user.role === UserRole.admin && reason.length < 10) throw new ConflictException('Administrator rerun reason is required.');
      await tx.v11WorkflowRevision.update({ where: { id: decision.workflowRevisionId }, data: { status: 'superseded', supersededAt: new Date() } });
      await tx.v11EvaluationRun.updateMany({ where: { group: { workflowRevisionId: decision.workflowRevisionId }, status: { in: ['pending', 'running'] } }, data: { status: 'stale', stale: true, completedAt: new Date() } });
      await tx.v11EvaluationGroup.updateMany({ where: { workflowRevisionId: decision.workflowRevisionId, status: { in: ['queued', 'running', 'review_required', 'adopted'] } }, data: { status: 'superseded' } });
      const revision = await tx.v11WorkflowRevision.create({ data: { videoId, ownerId: video.creatorId, revision: decision.workflowRevision.revision + 1, policySnapshot: { appeal: true, sourceResultId: dto.resultId } } });
      const sourceRun = await tx.v11EvaluationRun.findFirstOrThrow({ where: { groupId: decision.groupId }, orderBy: { runNumber: 'asc' } });
      const group = await tx.v11EvaluationGroup.create({ data: { videoId, ownerId: video.creatorId, inputRevisionId: decision.group.inputRevisionId, workflowRevisionId: revision.id, parentGroupId: decision.groupId, stage: 'content', status: 'queued', triggerReason: 'appeal', shadowMode: decision.group.shadowMode } });
      const run = await tx.v11EvaluationRun.create({ data: { groupId: group.id, runNumber: 1, runRole: 'appeal_primary', status: 'pending', blindContextHash: sourceRun.blindContextHash, modelProvider: sourceRun.modelProvider, modelName: sourceRun.modelName, modelConfigSnapshot: sourceRun.modelConfigSnapshot as Prisma.InputJsonValue, promptVersion: sourceRun.promptVersion, schemaVersion: sourceRun.schemaVersion, rubricVersion: sourceRun.rubricVersion, ratingVersion: sourceRun.ratingVersion, preprocessingVersion: sourceRun.preprocessingVersion, referenceSetVersion: sourceRun.referenceSetVersion } });
      const appeal = await tx.v11Appeal.create({ data: { videoId, workflowRevisionId: revision.id, stage: dto.stage, resultId: dto.resultId, reason, timestamps: dto.timestamps || undefined, submittedById: user.id, rerunGroupId: group.id } });
      await tx.v11WorkflowHold.create({ data: { videoId, workflowRevisionId: revision.id, groupId: group.id, holdType: 'appeal', reason: `评估结果存在异议：${reason}`, createdById: user.id } });
      const job = await this.jobs.enqueue(tx, { videoId, actorId: user.id, stage: 'v11_content', v11RunId: run.id, inputRefs: { workflowRevisionId: revision.id, inputRevisionId: decision.group.inputRevisionId }, maxAttempts: 2 });
      await tx.operationLog.create({ data: { userId: user.id, videoId, targetType: 'v11_appeal', targetId: appeal.id, actionType: 'v11_appeal_submitted', result: 'success', afterValue: { stage: dto.stage, resultId: dto.resultId, workflowRevision: revision.revision, rerunGroupId: group.id } } });
      return { appealId: appeal.id, workflowRevision: revision.revision, groupId: group.id, jobId: job.id, status: appeal.status };
    });
  }

  async get(videoId: string, user: AuthenticatedUser) {
    const video = await this.permissions.findVideoVisibleToUser(videoId, user);
    if (!video) throw new NotFoundException('Video not found.');
    const revision = await this.db.v11WorkflowRevision.findFirst({ where: { videoId, status: 'current' }, orderBy: { revision: 'desc' }, include: { holds: { where: { status: 'active' }, orderBy: { createdAt: 'desc' } }, appeals: { where: { status: 'active' }, orderBy: { createdAt: 'desc' }, select: { id: true, stage: true, resultId: true, reason: true, timestamps: true, status: true, submittedById: true, createdAt: true } } } });
    return { revision };
  }

  private reason(value: unknown) {
    const reason = typeof value === 'object' && value !== null && typeof (value as { reason?: unknown }).reason === 'string'
      ? (value as { reason: string }).reason.trim() : '';
    if (reason.length < 10 || reason.length > 500) throw new BadRequestException('Reason must contain 10 to 500 characters.');
    return reason;
  }

  async hold(videoId: string, body: unknown, user: AuthenticatedUser) {
    const reason = this.reason(body);
    const video = await this.permissions.findVideoVisibleToUser(videoId, user);
    if (!video) throw new NotFoundException('Video not found.');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
      const revision = await tx.v11WorkflowRevision.findFirst({ where: { videoId, status: 'current' }, orderBy: { revision: 'desc' } });
      if (!revision) throw new ConflictException('No current V1.1 workflow exists.');
      if (await tx.v11WorkflowHold.findFirst({ where: { workflowRevisionId: revision.id, holdType: 'manual', status: 'active' } })) throw new ConflictException('A manual hold is already active.');
      const hold = await tx.v11WorkflowHold.create({ data: { videoId, workflowRevisionId: revision.id, holdType: 'manual', reason, createdById: user.id } });
      await tx.operationLog.create({ data: { userId: user.id, videoId, targetType: 'v11_workflow_hold', targetId: hold.id, actionType: 'v11_workflow_held', result: 'success', comment: reason } });
      return hold;
    });
  }

  async resume(videoId: string, body: unknown, user: AuthenticatedUser) {
    const reason = this.reason(body);
    const video = await this.permissions.findVideoVisibleToUser(videoId, user);
    if (!video) throw new NotFoundException('Video not found.');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
      const revision = await tx.v11WorkflowRevision.findFirst({ where: { videoId, status: 'current' }, orderBy: { revision: 'desc' } });
      if (!revision) throw new ConflictException('No current V1.1 workflow exists.');
      const manual = await tx.v11WorkflowHold.findFirst({ where: { workflowRevisionId: revision.id, holdType: 'manual', status: 'active' }, orderBy: { createdAt: 'desc' } });
      if (!manual) throw new ConflictException('No resumable manual hold exists.');
      const blocking = await tx.v11WorkflowHold.count({ where: { workflowRevisionId: revision.id, status: 'active', id: { not: manual.id } } });
      if (blocking) throw new ConflictException('Another workflow hold must be resolved first.');
      const hold = await tx.v11WorkflowHold.update({ where: { id: manual.id }, data: { status: 'resolved', resolvedAt: new Date() } });
      await tx.operationLog.create({ data: { userId: user.id, videoId, targetType: 'v11_workflow_hold', targetId: hold.id, actionType: 'v11_workflow_resumed', result: 'success', comment: reason } });
      return hold;
    });
  }

  async resolveAppeal(videoId: string, appealId: string, body: unknown, user: AuthenticatedUser) {
    const reason = this.reason(body);
    const action = typeof body === 'object' && body !== null ? (body as { action?: unknown }).action : undefined;
    if (!['resolved', 'rejected'].includes(String(action))) throw new BadRequestException('Action must be resolved or rejected.');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
      const appeal = await tx.v11Appeal.findFirst({ where: { id: appealId, videoId, status: 'active' } });
      if (!appeal) throw new NotFoundException('Active appeal not found.');
      const updated = await tx.v11Appeal.update({ where: { id: appeal.id }, data: { status: String(action), resolvedAt: new Date() } });
      await tx.v11WorkflowHold.updateMany({ where: { workflowRevisionId: appeal.workflowRevisionId, holdType: 'appeal', status: 'active' }, data: { status: String(action) === 'resolved' ? 'resolved' : 'rejected', resolvedAt: new Date() } });
      await tx.operationLog.create({ data: { userId: user.id, videoId, targetType: 'v11_appeal', targetId: appeal.id, actionType: 'v11_appeal_resolved', result: 'success', comment: reason, afterValue: { action: String(action) } } });
      return updated;
    });
  }
}
