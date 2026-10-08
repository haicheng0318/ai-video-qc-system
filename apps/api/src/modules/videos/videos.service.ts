import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma, UserRole, Video, VideoStatus } from '@prisma/client';
import { createReadStream, statSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { Request, Response } from 'express';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { OperationLogAction } from '../operation-logs/operation-log-actions';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { VideoListQueryDto } from './dto/video-list-query.dto';
import { CreateVideoRevisionDto } from './dto/create-video-revision.dto';
import { VideoStorageService } from '../storage/video-storage.service';
import { CreateDirectUploadTicketDto } from './dto/create-direct-upload-ticket.dto';
import { CreateDirectVideoDto } from './dto/create-direct-video.dto';
import { CreateDirectVideoRevisionDto } from './dto/create-direct-video-revision.dto';
import { allowedVideoMimeTypes, getMaxVideoSizeBytes } from './video-upload.config';
import { QuotasService, assertIdentityActive } from '../quotas/quotas.service';
import { randomUUID } from 'node:crypto';
import { allowedVideoActions } from './video-actions';
import { rowsToCsv, videoReportRows } from './video-report';

const adminListFilterRoles: UserRole[] = [UserRole.admin, UserRole.content_owner];
const activeRevisionStatuses: VideoStatus[] = [
  VideoStatus.submitted,
  VideoStatus.ai_content_reviewing,
  VideoStatus.ai_content_failed,
  VideoStatus.pending_supervisor_review,
  VideoStatus.revision_required,
];

function rootDir() {
  return resolve(process.cwd(), '../../');
}

function storageDir() {
  return resolve(rootDir(), process.env.VIDEO_STORAGE_DIR || './storage/videos');
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionsService: PermissionsService,
    private readonly operationLogsService: OperationLogsService,
    @Optional() private readonly injectedVideoStorage?: VideoStorageService,
    @Optional() private readonly quotas?: QuotasService,
  ) {}

  async create(
    dto: CreateVideoDto,
    file: Express.Multer.File,
    user: AuthenticatedUser,
    requestMeta: { ipAddress?: string; userAgent?: string; uploadKey?: string },
  ) {
    return this.createWithFile(dto, file, user, requestMeta, false);
  }

  async createDirectUploadTicket(dto: CreateDirectUploadTicketDto, user: AuthenticatedUser, idempotencyKey?: string) {
    this.assertDirectUploadMetadata(dto.mimeType, dto.fileSizeBytes);
    if (idempotencyKey && !isUuid(idempotencyKey)) throw new BadRequestException('Idempotency-Key must be a UUID.');
    if (!this.quotas) return this.videoStorage.createDirectUpload(user.id, dto.fileName, dto.mimeType, dto.fileSizeBytes);
    await this.expireUploadTickets(user.id);
    return this.prisma.$transaction(async (tx) => {
      assertIdentityActive(await this.quotas!.lock(tx, user.id));
      const id = idempotencyKey || randomUUID();
      const existing = await tx.uploadTicket.findUnique({ where: { id } });
      if (existing) {
        if (existing.userId !== user.id || existing.fileSizeBytes !== BigInt(dto.fileSizeBytes) || existing.mimeType !== dto.mimeType || existing.status !== 'reserved' || existing.expiresAt <= new Date()) {
          throw new ConflictException('Upload ticket business key cannot change or has ended.');
        }
        const remainingSeconds = Math.max(1, Math.floor((existing.expiresAt.getTime() - Date.now()) / 1000));
        const upload = await this.videoStorage.createDirectUpload(user.id, dto.fileName, dto.mimeType, dto.fileSizeBytes, id, remainingSeconds);
        if (upload.objectPath !== existing.objectPath) throw new ConflictException('Upload ticket business key cannot change.');
        return { ...upload, ticketId: existing.id, expiresAt: existing.expiresAt };
      }
      await this.reserveUpload(tx, user.id, id, dto.fileSizeBytes);
      const upload = await this.videoStorage.createDirectUpload(user.id, dto.fileName, dto.mimeType, dto.fileSizeBytes, id);
      const ticket = await tx.uploadTicket.create({ data: { id, userId: user.id, objectPath: upload.objectPath, finalObjectPath: this.videoStorage.allocateFinalPath(user.id), fileSizeBytes: dto.fileSizeBytes, mimeType: dto.mimeType, expiresAt: new Date(Date.now() + upload.expiresInSeconds * 1000) } });
      return { ...upload, ticketId: id, expiresAt: ticket.expiresAt };
    });
  }

  async createDirect(
    dto: CreateDirectVideoDto,
    user: AuthenticatedUser,
    requestMeta: { ipAddress?: string; userAgent?: string },
  ) {
    this.assertDirectUploadMetadata(dto.mimeType, dto.fileSizeBytes);
    if (!this.quotas) {
      await this.videoStorage.verifyDirectUpload(dto.objectPath, user.id, dto);
      const duplicate = await this.prisma.video.findFirst({ where: { filePath: dto.objectPath }, select: { id: true } });
      if (duplicate) throw new ConflictException('This uploaded video has already been registered.');
    }
    return this.createWithFile(dto, {
      originalname: dto.originalFileName,
      path: dto.objectPath,
      mimetype: dto.mimeType,
      size: dto.fileSizeBytes,
    }, user, requestMeta, true);
  }

  private async createWithFile(
    dto: CreateVideoDto,
    file: Pick<Express.Multer.File, 'originalname' | 'path' | 'mimetype' | 'size'>,
    user: AuthenticatedUser,
    requestMeta: { ipAddress?: string; userAgent?: string; uploadKey?: string },
    alreadyStored: boolean,
    parentVideoId?: string,
  ) {
    let storedFilePath: string | undefined;
    let localTicketId: string | undefined;
    let ownsStoredObject = !alreadyStored;
    let ownsDirectClaim = false;
    try {
      if (this.quotas && alreadyStored) {
        const deadline = Date.now() + 30000;
        while (true) {
          const claim = await this.prisma.$transaction(async (tx) => {
            assertIdentityActive(await this.quotas!.lock(tx, user.id));
            const ticket = await tx.uploadTicket.findUnique({ where: { objectPath: file.path } });
            if (!ticket || ticket.userId !== user.id || ticket.fileSizeBytes !== BigInt(file.size) || ticket.mimeType !== file.mimetype) throw new BadRequestException('Valid matching upload ticket required.');
            if (ticket.status === 'confirmed') return { video: await tx.video.findUniqueOrThrow({ where: { id: ticket.videoId! } }), ticket, claimed: false };
            if (ticket.expiresAt <= new Date() || !['reserved', 'confirming'].includes(ticket.status)) throw new ConflictException('Upload ticket expired or canceled.');
            if (ticket.status === 'confirming') return { video: null, ticket, claimed: false };
            await tx.uploadTicket.update({ where: { id: ticket.id }, data: { status: 'confirming' } });
            return { video: null, ticket, claimed: true };
          });
          if (claim.video) {
            if (claim.video.parentVideoId !== (parentVideoId || null)) throw new ConflictException('Upload business key cannot change revision parent.');
            return this.serializeVideo(claim.video);
          }
          if (claim.claimed) {
            ownsDirectClaim = true;
            storedFilePath = await this.videoStorage.finalizeDirectUpload(file.path, user.id, { mimeType: file.mimetype, fileSizeBytes: file.size }, claim.ticket.finalObjectPath!);
            ownsStoredObject = true;
            break;
          }
          if (Date.now() >= deadline) throw new ConflictException('Upload confirmation is still in progress.');
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      if (this.quotas && !alreadyStored) {
        const actual = statSync(file.path).size;
        if (!Number.isSafeInteger(actual) || actual < 1 || actual > getMaxVideoSizeBytes()) throw new BadRequestException('Invalid actual file size.');
        file = { ...file, size: actual };
        const id = requestMeta.uploadKey || randomUUID();
        const existing = await this.prisma.$transaction(async (tx) => {
          assertIdentityActive(await this.quotas!.lock(tx, user.id));
          const ticket = await tx.uploadTicket.findUnique({ where: { id } });
          if (ticket) {
            if (ticket.userId !== user.id || ticket.fileSizeBytes !== BigInt(actual) || ticket.mimeType !== file.mimetype) throw new ConflictException('Upload business key cannot change.');
            if (ticket.status === 'confirmed') return tx.video.findUniqueOrThrow({ where: { id: ticket.videoId! } });
            throw new ConflictException('Upload business key is in progress or has ended.');
          }
          await this.reserveUpload(tx, user.id, id, actual);
          await tx.uploadTicket.create({ data: { id, userId: user.id, objectPath: `pending:${user.id}/${id}`, fileSizeBytes: actual, mimeType: file.mimetype, status: 'uploading', expiresAt: new Date(Date.now() + 900000) } });
          return null;
        });
        if (existing) {
          if (existing.parentVideoId !== (parentVideoId || null)) throw new ConflictException('Upload business key cannot change revision parent.');
          await this.cleanupFailedUpload(undefined, file.path); return this.serializeVideo(existing);
        }
        localTicketId = id;
      }
      if (!alreadyStored) storedFilePath = await this.videoStorage.storeUploadedFile(file);
      const video = await this.prisma.$transaction(async (transaction) => {
        let parent: Video | null = null;
        if (parentVideoId) {
          await transaction.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${parentVideoId}::uuid FOR UPDATE`);
          parent = await transaction.video.findUnique({ where: { id: parentVideoId } });
          if (!parent) throw new NotFoundException('Video not found.');
          await this.permissionsService.assertCanUploadRevision(user, parent, requestMeta);
        }
        let ticketId = localTicketId;
        let isTrial = user.role === UserRole.visitor;
        if (this.quotas) {
          const currentActor = await this.quotas.lock(transaction, user.id); assertIdentityActive(currentActor);
          isTrial = currentActor.role === UserRole.visitor;
          const ticket = alreadyStored ? await transaction.uploadTicket.findUnique({ where: { objectPath: file.path } }) : await transaction.uploadTicket.findUnique({ where: { id: localTicketId! } });
          if (!ticket || ticket.userId !== user.id || ticket.fileSizeBytes !== BigInt(file.size) || ticket.mimeType !== file.mimetype) throw new BadRequestException('Valid matching upload ticket required.');
          if (ticket.status === 'confirmed') {
            const duplicate = await transaction.video.findUniqueOrThrow({ where: { id: ticket.videoId! } });
            if (duplicate.parentVideoId !== (parentVideoId || null)) throw new ConflictException('Upload business key cannot change revision parent.');
            return duplicate;
          }
          if (!['confirming', 'uploading'].includes(ticket.status) || ticket.expiresAt <= new Date()) throw new ConflictException('Upload ticket expired or canceled.');
          ticketId = ticket.id;
        }
        if (parent) {
          if (parent.status !== VideoStatus.revision_required || (await transaction.supervisorReview.findUnique({ where: { videoId: parent.id } }))?.decision !== VideoStatus.revision_required) throw new ConflictException('A revision-required supervisor review is required.');
          if (await transaction.video.findFirst({ where: { parentVideoId: parent.id, status: { in: activeRevisionStatuses } } })) throw new ConflictException('An active revision already exists for this video.');
          isTrial = parent.isTrial;
        }
        const persistedFilePath = storedFilePath || file.path;
        const createdVideo = await transaction.video.create({
          data: {
            title: dto.title,
            originalFileName: file.originalname,
            filePath: persistedFilePath,
            fileUrl: null,
            mimeType: file.mimetype,
            fileSizeBytes: BigInt(file.size),
            brand: dto.brand || null,
            product: dto.product || null,
            platform: dto.platform || null,
            videoType: dto.videoType,
            scriptDescription: dto.scriptDescription || null,
            isForAds: dto.isForAds ?? false,
            isTrial,
            isEventVideo: dto.isEventVideo ?? false,
            eventName: dto.eventName || null,
            relatedRequirement: dto.relatedRequirement || null,
            creatorId: parent?.creatorId || user.id,
            parentVideoId: parent?.id,
            version: parent ? parent.version + 1 : 1,
            status: VideoStatus.submitted,
          },
          include: {
            creator: {
              select: { id: true, name: true, account: true, role: true },
            },
          },
        });

        if (this.quotas && ticketId) await this.confirmUpload(transaction, user.id, ticketId, createdVideo.id);

        await this.operationLogsService.create(
          {
            userId: user.id,
            videoId: createdVideo.id,
            targetType: 'video',
            targetId: createdVideo.id,
            actionType: parent ? OperationLogAction.VideoRevisionUploaded : OperationLogAction.VideoUploaded,
            result: 'success',
            afterValue: {
              title: createdVideo.title,
              videoType: createdVideo.videoType,
              status: createdVideo.status,
              fileName: createdVideo.originalFileName,
            },
            comment: 'Video uploaded in phase 1. AI review is reserved for later phases.',
            ipAddress: requestMeta.ipAddress,
            userAgent: requestMeta.userAgent,
          },
          transaction,
        );

        return createdVideo;
      }, { timeout: 30000 });

      return this.serializeVideo(video);
    } catch (error) {
      if (this.quotas && (localTicketId || ownsDirectClaim)) {
        // A failed/uncertain commit is not evidence that the final object is unreferenced.
        // Cancel before cleanup so a concurrent retry can never copy over this attempt's final key.
        try {
          const ticket = localTicketId ? await this.prisma.uploadTicket.findUnique({ where: { id: localTicketId } }) : await this.prisma.uploadTicket.findUnique({ where: { objectPath: file.path } });
          if (ticket && ticket.userId === user.id && ticket.status !== 'confirmed') {
            await this.cancelDirectUploadTicket(ticket.id, user);
            if (ownsStoredObject && !await this.prisma.video.findFirst({ where: { filePath: storedFilePath || file.path } })) await this.cleanupFailedUpload(storedFilePath, file.path);
          }
        } catch { /* Retain for the durable sweep; never guess that an unknown commit failed. */ }
      } else if (ownsStoredObject) await this.cleanupFailedUpload(storedFilePath, file.path);
      throw error;
    }
  }

  private async reserveUpload(tx: Prisma.TransactionClient, userId: string, ticketId: string, bytes: number) {
    await this.quotas!.reserve(tx, userId, 'upload_count', 1, `upload:${ticketId}`);
    await this.quotas!.reserve(tx, userId, 'storage_bytes', bytes, `upload:${ticketId}`);
  }
  private async confirmUpload(tx: Prisma.TransactionClient, userId: string, ticketId: string, videoId: string) {
    await this.quotas!.commit(tx, userId, 'upload_count', `upload:${ticketId}`);
    await this.quotas!.commit(tx, userId, 'storage_bytes', `upload:${ticketId}`);
    await tx.uploadTicket.update({ where: { id: ticketId }, data: { status: 'confirmed', videoId } });
  }
  async cancelDirectUploadTicket(ticketId: string, user: AuthenticatedUser) {
    if (!isUuid(ticketId)) throw new NotFoundException('Upload ticket not found.');
    return this.prisma.$transaction(async (tx) => {
      await this.quotas!.lock(tx, user.id);
      const ticket = await tx.uploadTicket.findUnique({ where: { id: ticketId } });
      if (!ticket || ticket.userId !== user.id) throw new NotFoundException('Upload ticket not found.');
      if (ticket.status === 'confirmed') throw new ConflictException('Confirmed uploads cannot be canceled.');
      await this.quotas!.release(tx, user.id, 'upload_count', `upload:${ticketId}`);
      await this.quotas!.release(tx, user.id, 'storage_bytes', `upload:${ticketId}`);
      await tx.uploadTicket.update({ where: { id: ticketId }, data: { status: 'canceled' } });
      return { success: true };
    });
  }
  async expireUploadTickets(userId?: string) {
    if (!this.quotas) return;
    const expired = await this.prisma.uploadTicket.findMany({ where: { userId, status: { in: ['reserved', 'uploading', 'confirming'] }, expiresAt: { lte: new Date() } }, take: 100 });
    for (const ticket of expired) await this.cancelDirectUploadTicket(ticket.id, { id: ticket.userId } as AuthenticatedUser).catch((error) => { if (!(error instanceof ConflictException)) throw error; });
  }

  async list(user: AuthenticatedUser, query: VideoListQueryDto) {
    const visibilityWhere = this.permissionsService.buildVideoVisibilityWhere(user);
    const where: Prisma.VideoWhereInput = query.search
      ? {
          AND: [
            visibilityWhere,
            {
              OR: [
                { title: { contains: query.search, mode: 'insensitive' } },
                { brand: { contains: query.search, mode: 'insensitive' } },
                { product: { contains: query.search, mode: 'insensitive' } },
                { platform: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          ],
        }
      : { ...visibilityWhere };

    if (query.status) where.status = query.status;
    if (query.videoType) where.videoType = query.videoType;
    if (query.brand) where.brand = { contains: query.brand, mode: 'insensitive' };
    if (query.product) where.product = { contains: query.product, mode: 'insensitive' };
    if (query.platform) where.platform = { contains: query.platform, mode: 'insensitive' };
    if (query.creatorId && adminListFilterRoles.includes(user.role)) {
      where.creatorId = query.creatorId;
    }

    const [videos, total] = await this.prisma.$transaction([this.prisma.video.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        creator: {
          select: { id: true, name: true, account: true, role: true },
        },
        aiContentReviews: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        aiResultReviews: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        finalVideoEvaluations: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    }), this.prisma.video.count({ where })]);

    return {
      items: videos.map((video) => this.serializeVideo(user.role === 'visitor' ? this.visitorVideo(video) : video)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async createRevision(
    parentVideoId: string,
    dto: CreateVideoRevisionDto,
    file: Express.Multer.File,
    user: AuthenticatedUser,
    requestMeta: { ipAddress?: string; userAgent?: string; uploadKey?: string },
  ) {
    return this.createRevisionWithFile(parentVideoId, dto, file, user, requestMeta, false);
  }

  async createDirectRevision(
    parentVideoId: string,
    dto: CreateDirectVideoRevisionDto,
    user: AuthenticatedUser,
    requestMeta: { ipAddress?: string; userAgent?: string },
  ) {
    this.assertDirectUploadMetadata(dto.mimeType, dto.fileSizeBytes);
    if (!this.quotas) {
      await this.videoStorage.verifyDirectUpload(dto.objectPath, user.id, dto);
      const duplicate = await this.prisma.video.findFirst({ where: { filePath: dto.objectPath }, select: { id: true } });
      if (duplicate) throw new ConflictException('This uploaded video has already been registered.');
    }
    return this.createRevisionWithFile(parentVideoId, dto, {
      originalname: dto.originalFileName,
      path: dto.objectPath,
      mimetype: dto.mimeType,
      size: dto.fileSizeBytes,
    }, user, requestMeta, true);
  }

  private async createRevisionWithFile(
    parentVideoId: string,
    dto: CreateVideoRevisionDto,
    file: Pick<Express.Multer.File, 'originalname' | 'path' | 'mimetype' | 'size'>,
    user: AuthenticatedUser,
    requestMeta: { ipAddress?: string; userAgent?: string; uploadKey?: string },
    alreadyStored: boolean,
  ) {
    if (this.quotas) {
      try {
        if (!isUuid(parentVideoId)) throw new NotFoundException('Video not found.');
        const parent = await this.prisma.video.findUnique({ where: { id: parentVideoId } });
        if (!parent) throw new NotFoundException('Video not found.');
        await this.permissionsService.assertCanUploadRevision(user, parent, requestMeta);
        const merged = { ...parent, ...Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)) } as unknown as CreateVideoDto;
        return this.createWithFile(merged, file, user, requestMeta, alreadyStored, parentVideoId);
      } catch (error) { if (!alreadyStored) await this.cleanupFailedUpload(undefined, file.path); throw error; }
    }
    let storedFilePath: string | undefined;
    try {
      if (!isUuid(parentVideoId)) throw new NotFoundException('Video not found.');
      const parent = await this.prisma.video.findUnique({ where: { id: parentVideoId } });
      if (!parent) throw new NotFoundException('Video not found.');
      await this.permissionsService.assertCanUploadRevision(user, parent, requestMeta);
      storedFilePath = alreadyStored ? file.path : await this.videoStorage.storeUploadedFile(file);
      const persistedFilePath = storedFilePath;

      const revision = await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw(
          Prisma.sql`SELECT id FROM videos WHERE id = ${parentVideoId}::uuid FOR UPDATE`,
        );
        const lockedParent = await transaction.video.findUnique({ where: { id: parentVideoId } });
        if (!lockedParent) throw new NotFoundException('Video not found.');
        if (lockedParent.status !== VideoStatus.revision_required) {
          throw new ConflictException('Only videos requiring revision can accept a revision upload.');
        }

        const review = await transaction.supervisorReview.findUnique({ where: { videoId: parentVideoId } });
        if (!review || review.decision !== VideoStatus.revision_required) {
          throw new ConflictException('A revision-required supervisor review is required.');
        }
        const activeRevision = await transaction.video.findFirst({
          where: {
            parentVideoId,
            status: { in: activeRevisionStatuses },
          },
          select: { id: true },
        });
        if (activeRevision) {
          throw new ConflictException('An active revision already exists for this video.');
        }

        const created = await transaction.video.create({
          data: {
            title: dto.title?.trim() || lockedParent.title,
            originalFileName: file.originalname,
            filePath: persistedFilePath,
            fileUrl: null,
            coverUrl: null,
            mimeType: file.mimetype,
            fileSizeBytes: BigInt(file.size),
            duration: null,
            brand: dto.brand ?? lockedParent.brand,
            product: dto.product ?? lockedParent.product,
            platform: dto.platform ?? lockedParent.platform,
            videoType: dto.videoType ?? lockedParent.videoType,
            scriptDescription: dto.scriptDescription ?? lockedParent.scriptDescription,
            isForAds: dto.isForAds ?? lockedParent.isForAds,
            isEventVideo: dto.isEventVideo ?? lockedParent.isEventVideo,
            eventName: dto.eventName ?? lockedParent.eventName,
            relatedRequirement: dto.relatedRequirement ?? lockedParent.relatedRequirement,
            creatorId: lockedParent.creatorId,
            isTrial: lockedParent.isTrial,
            status: VideoStatus.submitted,
            parentVideoId: lockedParent.id,
            version: lockedParent.version + 1,
          },
          include: {
            creator: { select: { id: true, name: true, account: true, role: true } },
          },
        });
        await this.operationLogsService.create({
          userId: user.id,
          videoId: created.id,
          targetType: 'video',
          targetId: created.id,
          actionType: OperationLogAction.VideoRevisionUploaded,
          result: 'success',
          afterValue: {
            parentVideoId: lockedParent.id,
            newVideoId: created.id,
            creatorId: created.creatorId,
            uploadedBy: user.id,
            version: created.version,
            status: created.status,
          },
          comment: 'Video revision uploaded.',
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        }, transaction);
        return created;
      });
      return this.serializeVideo(revision);
    } catch (error) {
      await this.cleanupFailedUpload(storedFilePath, file.path);
      throw error;
    }
  }

  async detail(id: string, user: AuthenticatedUser, requestMeta: { ipAddress?: string; userAgent?: string }) {
    const video = await this.prisma.video.findUnique({
      where: { id },
      include: {
        creator: {
          select: { managerId: true },
        },
      },
    });
    if (!video) return null;

    await this.permissionsService.assertCanAccessVideo(user, video, {
      ...requestMeta,
      action: 'Video detail access denied.',
    });

    await this.operationLogsService.create({
      userId: user.id,
      videoId: id,
      targetType: 'video',
      targetId: id,
      actionType: OperationLogAction.VideoDetailViewed,
      result: 'success',
      comment: 'Video detail viewed.',
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    const detail = await this.prisma.video.findUnique({
      where: { id },
      include: {
        creator: {
          select: { id: true, name: true, account: true, role: true },
        },
        aiContentReviews: {
          include: { scores: true },
          orderBy: { createdAt: 'desc' },
        },
        supervisorReview: {
          include: {
            reviewer: { select: { id: true, name: true, account: true, role: true } },
          },
        },
        resultMetrics: {
          orderBy: { createdAt: 'desc' },
        },
        aiResultReviews: {
          orderBy: { createdAt: 'desc' },
        },
        ruleEngineResults: {
          orderBy: { createdAt: 'desc' },
        },
        finalVideoEvaluations: {
          orderBy: { createdAt: 'desc' },
        },
        revisions: {
          orderBy: { version: 'asc' },
          select: {
            id: true,
            title: true,
            status: true,
            version: true,
            createdAt: true,
          },
        },
        parentVideo: {
          select: {
            id: true,
            title: true,
            status: true,
            version: true,
            createdAt: true,
          },
        },
        operationLogs: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!detail) return null;
    const versionChain = await this.buildVersionChain(detail);
    const visible = user.role === 'visitor' ? this.visitorVideo(detail) : detail;
    const latestMetric = detail.resultMetrics[0];
    const latestResult = detail.aiResultReviews[0];
    const latestRule = detail.ruleEngineResults[0];
    const latestFinal = detail.finalVideoEvaluations[0];
    const allowedActions = allowedVideoActions(user, {
      status: detail.status, creatorId: detail.creatorId, creatorManagerId: video.creator.managerId,
      videoType: detail.videoType, isForAds: detail.isForAds,
    }, {
      hasMetric: Boolean(latestMetric), resultReviewRunning: latestResult?.status === 'running',
      resultReviewCurrentSucceeded: latestResult?.status === 'succeeded' && latestResult.resultMetricId === latestMetric?.id,
      resultReviewSucceeded: latestResult?.status === 'succeeded',
      ruleCurrent: latestRule?.ruleVersion === 'rule-engine-v1' && latestRule.resultReviewId === latestResult?.id,
      ruleSufficient: latestRule?.dataSufficiency === 'sufficient', finalRunning: latestFinal?.status === 'running',
      finalCurrentSucceeded: latestFinal?.status === 'succeeded' && latestFinal.ruleEngineResultId === latestRule?.id,
      finalSucceeded: latestFinal?.status === 'succeeded', finalConfirmed: Boolean(latestFinal?.confirmedAt),
    });
    return this.serializeVideo({
      ...visible,
      versionChain,
      allowedActions,
      latestResultMetricId: user.role === UserRole.visitor ? null : latestMetric?.id || null,
    });
  }

  async exportReport(id: string, user: AuthenticatedUser, requestMeta: { ipAddress?: string; userAgent?: string }) {
    if (!isUuid(id)) throw new NotFoundException('Video not found.');
    const video = await this.prisma.video.findUnique({
      where: { id }, include: {
        creator: { select: { managerId: true } },
        aiContentReviews: { where: { status: 'succeeded' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 },
        aiResultReviews: { where: { status: 'succeeded' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 },
        finalVideoEvaluations: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 },
      },
    });
    if (!video) throw new NotFoundException('Video not found.');
    await this.permissionsService.assertCanAccessVideo(user, video, { ...requestMeta, action: 'Video report export denied.' });
    await this.operationLogsService.create({
      userId: user.id, videoId: id, targetType: 'video_report', targetId: id,
      actionType: OperationLogAction.VideoReportExported, result: 'success',
      afterValue: { scope: user.role === UserRole.visitor ? 'content_only' : 'full' },
      comment: 'Authorized video report exported.', ...requestMeta,
    });
    return { filename: `video-report-${id}.csv`, content: rowsToCsv(videoReportRows(video as any, user.role === UserRole.visitor)) };
  }

  async prepareVideoFile(id: string, user: AuthenticatedUser, requestMeta: { ipAddress?: string; userAgent?: string }) {
    const video = await this.prisma.video.findUnique({
      where: { id },
      include: {
        creator: {
          select: { managerId: true },
        },
      },
    });

    if (!video) {
      return null;
    }

    await this.permissionsService.assertCanAccessVideo(user, video, {
      ...requestMeta,
      action: 'Video file access denied.',
    });

    await this.operationLogsService.create({
      userId: user.id,
      videoId: id,
      targetType: 'video',
      targetId: id,
      actionType: OperationLogAction.VideoFileAccessed,
      result: 'success',
      comment: 'Video file accessed through authenticated endpoint.',
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return { video };
  }

  streamVideoFile(video: Video, request: Request, response: Response) {
    if (this.videoStorage.isCosPath(video.filePath)) {
      return this.videoStorage.createReadUrl(video.filePath).then((url) => {
        response.redirect(302, url);
      });
    }

    const absolutePath = resolve(rootDir(), video.filePath);
    const relativePath = relative(storageDir(), absolutePath);
    if (
      relativePath === ''
      || relativePath === '..'
      || relativePath.startsWith(`..${sep}`)
      || isAbsolute(relativePath)
    ) {
      throw new NotFoundException('Video file path is invalid.');
    }

    const stats = statSync(absolutePath);
    const range = request.headers.range;
    const commonHeaders = {
      'Content-Type': video.mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(basename(video.originalFileName))}"`,
      'Accept-Ranges': 'bytes',
    };

    if (range === undefined) {
      response.writeHead(200, {
        ...commonHeaders,
        'Content-Length': stats.size,
      });
      createReadStream(absolutePath).pipe(response);
      return;
    }

    const parsedRange = this.parseSingleRange(range, stats.size);
    if (!parsedRange) {
      response.writeHead(416, {
        ...commonHeaders,
        'Content-Range': `bytes */${stats.size}`,
        'Content-Length': 0,
      });
      response.end();
      return;
    }

    const { start, end } = parsedRange;
    const chunkSize = end - start + 1;

    response.writeHead(206, {
      ...commonHeaders,
      'Content-Range': `bytes ${start}-${end}/${stats.size}`,
      'Content-Length': chunkSize,
    });

    createReadStream(absolutePath, { start, end }).pipe(response);
  }

  async createVideoPlaybackUrl(video: Video) {
    if (!this.videoStorage.isCosPath(video.filePath)) {
      return { url: null };
    }

    return { url: await this.videoStorage.createReadUrl(video.filePath) };
  }

  private parseSingleRange(range: string, fileSize: number) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]) || fileSize <= 0) return null;

    const parseInteger = (value: string) => {
      if (!/^\d+$/.test(value)) return null;
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) ? parsed : null;
    };

    if (!match[1]) {
      const suffixLength = parseInteger(match[2]);
      if (suffixLength === null || suffixLength <= 0) return null;
      return {
        start: suffixLength >= fileSize ? 0 : fileSize - suffixLength,
        end: fileSize - 1,
      };
    }

    const start = parseInteger(match[1]);
    if (start === null || start >= fileSize) return null;
    const requestedEnd = match[2] ? parseInteger(match[2]) : fileSize - 1;
    if (requestedEnd === null || requestedEnd < start) return null;

    return { start, end: Math.min(requestedEnd, fileSize - 1) };
  }

  private assertDirectUploadMetadata(mimeType: string, fileSizeBytes: number) {
    if (!this.videoStorage.isCosEnabled()) {
      throw new BadRequestException('Direct upload is only available with COS storage.');
    }
    if (!allowedVideoMimeTypes.has(mimeType.toLowerCase())) {
      throw new BadRequestException('Only MP4, MOV, and WEBM videos are supported.');
    }
    if (!Number.isSafeInteger(fileSizeBytes) || fileSizeBytes < 1 || fileSizeBytes > Math.min(getMaxVideoSizeBytes(), 500 * 1024 * 1024)) {
      throw new BadRequestException(`Video size must be between 1 byte and ${getMaxVideoSizeBytes()} bytes.`);
    }
  }

  private get videoStorage() {
    return this.injectedVideoStorage ?? new VideoStorageService();
  }

  private async cleanupFailedUpload(storedFilePath: string | undefined, temporaryPath: string) {
    try {
      await this.videoStorage.deleteStoredFile(storedFilePath || temporaryPath);
    } catch (cleanupError) {
      const errorCode = cleanupError instanceof Error && 'code' in cleanupError
        ? String((cleanupError as NodeJS.ErrnoException).code)
        : 'unknown';
      this.logger.error(`Failed to clean up uploaded video after transaction failure (${errorCode}).`);
    }
  }

  private async buildVersionChain(video: { id: string; title: string; status: VideoStatus; version: number; parentVideoId: string | null; createdAt: Date }) {
    const chain = [{
      id: video.id,
      title: video.title,
      status: video.status,
      version: video.version,
      createdAt: video.createdAt,
    }];
    const visited = new Set([video.id]);
    let parentVideoId = video.parentVideoId;
    while (parentVideoId) {
      if (visited.has(parentVideoId)) break;
      visited.add(parentVideoId);
      const parent = await this.prisma.video.findUnique({
        where: { id: parentVideoId },
        select: {
          id: true,
          title: true,
          status: true,
          version: true,
          parentVideoId: true,
          createdAt: true,
        },
      });
      if (!parent) break;
      chain.unshift({
        id: parent.id,
        title: parent.title,
        status: parent.status,
        version: parent.version,
        createdAt: parent.createdAt,
      });
      parentVideoId = parent.parentVideoId;
    }
    return chain;
  }

  private serializeVideo<T extends Record<string, any>>(video: T) {
    const internalFields = new Set(['rawResponse', 'successKey', 'filePath']);
    const serialized = JSON.parse(
      JSON.stringify(video, (key, value) => {
        if (internalFields.has(key)) return undefined;
        return typeof value === 'bigint' ? value.toString() : value;
      }),
    );
    if (
      serialized.supervisorReview
      && !Array.isArray(serialized.supervisorReview.revisionRequirements)
    ) {
      serialized.supervisorReview.revisionRequirements = [];
    }
    return serialized;
  }

  private visitorVideo<T extends Record<string, any>>(video: T) {
    const { resultMetrics, aiResultReviews, ruleEngineResults, finalVideoEvaluations, supervisorReview, operationLogs, ...safe } = video;
    return safe;
  }
}
