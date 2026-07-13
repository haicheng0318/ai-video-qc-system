import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole, Video, VideoType } from '@prisma/client';
import { createReadStream, statSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { Request, Response } from 'express';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { OperationLogAction } from '../operation-logs/operation-log-actions';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVideoDto } from './dto/create-video.dto';

const adminListFilterRoles: UserRole[] = [UserRole.admin, UserRole.content_owner];

function rootDir() {
  return resolve(process.cwd(), '../../');
}

function storageDir() {
  return resolve(rootDir(), process.env.VIDEO_STORAGE_DIR || './storage/videos');
}

function relativeToRoot(path: string) {
  return relative(rootDir(), path);
}

@Injectable()
export class VideosService {
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
    const video = await this.prisma.video.create({
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
        status: 'submitted',
      },
      include: {
        creator: {
          select: { id: true, name: true, account: true, role: true },
        },
      },
    });

    await this.operationLogsService.create({
      userId: user.id,
      videoId: video.id,
      actionType: OperationLogAction.VideoUploaded,
      afterValue: {
        title: video.title,
        videoType: video.videoType,
        status: video.status,
        fileName: video.originalFileName,
      },
      comment: 'Video uploaded in phase 1. AI review is reserved for later phases.',
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return this.serializeVideo(video);
  }

  async list(user: AuthenticatedUser, query: Record<string, string | undefined>) {
    const where: Prisma.VideoWhereInput = {
      ...this.permissionsService.buildVideoVisibilityWhere(user),
    };

    if (query.status) where.status = query.status as never;
    if (query.videoType) where.videoType = query.videoType as VideoType;
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
      actionType: OperationLogAction.VideoDetailViewed,
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
        supervisorReviews: {
          orderBy: { createdAt: 'desc' },
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
        operationLogs: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!detail) return null;
    return this.serializeVideo(detail);
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
      actionType: OperationLogAction.VideoFileAccessed,
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

  private serializeVideo<T extends Record<string, any>>(video: T) {
    return JSON.parse(
      JSON.stringify(video, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
    );
  }
}
