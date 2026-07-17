import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole, Video, VideoStatus } from '@prisma/client';
import { createReadStream, statSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import { Request, Response } from 'express';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { OperationLogAction } from '../operation-logs/operation-log-actions';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { VideoListQueryDto } from './dto/video-list-query.dto';
import { CreateVideoRevisionDto } from './dto/create-video-revision.dto';

const adminListFilterRoles: UserRole[] = [UserRole.admin, UserRole.content_owner];
const activeRevisionStatuses: VideoStatus[] = [
  VideoStatus.submitted,
  VideoStatus.ai_content_reviewing,
  VideoStatus.ai_content_failed,
  VideoStatus.pending_supervisor_review,
];

function rootDir() {
  return resolve(process.cwd(), '../../');
}

function storageDir() {
  return resolve(rootDir(), process.env.VIDEO_STORAGE_DIR || './storage/videos');
}

function relativeToRoot(path: string) {
  return relative(rootDir(), path);
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
  ) {}

  async create(
    dto: CreateVideoDto,
    file: Express.Multer.File,
    user: AuthenticatedUser,
    requestMeta: { ipAddress?: string; userAgent?: string },
  ) {
    try {
      const video = await this.prisma.$transaction(async (transaction) => {
        const createdVideo = await transaction.video.create({
          data: {
            title: dto.title,
            originalFileName: file.originalname,
            filePath: relativeToRoot(file.path),
            fileUrl: null,
            mimeType: file.mimetype,
            fileSizeBytes: BigInt(file.size),
            brand: dto.brand || null,
            product: dto.product || null,
            platform: dto.platform || null,
            videoType: dto.videoType,
            scriptDescription: dto.scriptDescription || null,
            isForAds: dto.isForAds ?? false,
            isEventVideo: dto.isEventVideo ?? false,
            eventName: dto.eventName || null,
            relatedRequirement: dto.relatedRequirement || null,
            creatorId: user.id,
            status: VideoStatus.submitted,
          },
          include: {
            creator: {
              select: { id: true, name: true, account: true, role: true },
            },
          },
        });

        await this.operationLogsService.create(
          {
            userId: user.id,
            videoId: createdVideo.id,
            targetType: 'video',
            targetId: createdVideo.id,
            actionType: OperationLogAction.VideoUploaded,
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
      });

      return this.serializeVideo(video);
    } catch (error) {
      await this.removeUploadedFile(file.path);
      throw error;
    }
  }

  async list(user: AuthenticatedUser, query: VideoListQueryDto) {
    const where: Prisma.VideoWhereInput = {
      ...this.permissionsService.buildVideoVisibilityWhere(user),
    };

    if (query.status) where.status = query.status;
    if (query.videoType) where.videoType = query.videoType;
    if (query.brand) where.brand = { contains: query.brand, mode: 'insensitive' };
    if (query.product) where.product = { contains: query.product, mode: 'insensitive' };
    if (query.platform) where.platform = { contains: query.platform, mode: 'insensitive' };
    if (query.creatorId && adminListFilterRoles.includes(user.role)) {
      where.creatorId = query.creatorId;
    }

    const videos = await this.prisma.video.findMany({
      where,
      orderBy: { createdAt: 'desc' },
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
    });

    return {
      items: videos.map((video) => this.serializeVideo(video)),
    };
  }

  async createRevision(
    parentVideoId: string,
    dto: CreateVideoRevisionDto,
    file: Express.Multer.File,
    user: AuthenticatedUser,
    requestMeta: { ipAddress?: string; userAgent?: string },
  ) {
    try {
      if (!isUuid(parentVideoId)) throw new NotFoundException('Video not found.');
      const parent = await this.prisma.video.findUnique({ where: { id: parentVideoId } });
      if (!parent) throw new NotFoundException('Video not found.');
      await this.permissionsService.assertCanUploadRevision(user, parent, requestMeta);

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
            filePath: relativeToRoot(file.path),
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
      await this.removeUploadedFile(file.path);
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
    return this.serializeVideo({ ...detail, versionChain });
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
    const absolutePath = resolve(rootDir(), video.filePath);
    if (!absolutePath.startsWith(storageDir())) {
      throw new NotFoundException('Video file path is invalid.');
    }

    const stats = statSync(absolutePath);
    const range = request.headers.range;
    const commonHeaders = {
      'Content-Type': video.mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(basename(video.originalFileName))}"`,
      'Accept-Ranges': 'bytes',
    };

    if (!range) {
      response.writeHead(200, {
        ...commonHeaders,
        'Content-Length': stats.size,
      });
      createReadStream(absolutePath).pipe(response);
      return;
    }

    const [startText, endText] = range.replace(/bytes=/, '').split('-');
    const start = Number.parseInt(startText, 10);
    const end = endText ? Number.parseInt(endText, 10) : stats.size - 1;
    const chunkSize = end - start + 1;

    response.writeHead(206, {
      ...commonHeaders,
      'Content-Range': `bytes ${start}-${end}/${stats.size}`,
      'Content-Length': chunkSize,
    });

    createReadStream(absolutePath, { start, end }).pipe(response);
  }

  private async removeUploadedFile(filePath: string) {
    try {
      await unlink(filePath);
    } catch (cleanupError) {
      const errorCode = cleanupError instanceof Error && 'code' in cleanupError
        ? String((cleanupError as NodeJS.ErrnoException).code)
        : 'unknown';
      this.logger.error(`Failed to clean up uploaded video file after transaction failure (${errorCode}).`);
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
    return JSON.parse(
      JSON.stringify(video, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
    );
  }
}
