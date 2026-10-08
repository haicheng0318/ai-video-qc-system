import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VideoStatus, VideoType } from '@prisma/client';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { OperationLogAction } from '../operation-logs/operation-log-actions';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { CaseListQueryDto } from './dto/case-list-query.dto';
import { MarkCaseDto } from './dto/mark-case.dto';
import { rowsToCsv } from '../videos/video-report';

type RequestMeta = { ipAddress?: string; userAgent?: string };
const exportLimit = 50;
const finalStatuses = new Set<VideoStatus>([
  VideoStatus.final_effective, VideoStatus.final_low_effective, VideoStatus.final_invalid,
]);
const htmlPattern = /<\/?[a-z][^>]*>/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function shanghaiDayBoundary(value: string, end: boolean) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) throw new BadRequestException('Case dates must use an ISO calendar date.');
  const [year, month, day] = match.slice(1).map(Number);
  const checked = new Date(Date.UTC(year, month - 1, day));
  if (checked.getUTCFullYear() !== year || checked.getUTCMonth() !== month - 1 || checked.getUTCDate() !== day) {
    throw new BadRequestException('Case date is invalid.');
  }
  return new Date(Date.UTC(year, month - 1, day + (end ? 1 : 0)) - 8 * 3_600_000 - (end ? 1 : 0));
}

function shanghaiDateTime(value: string | null) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date(value));
}

@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly operationLogs: OperationLogsService,
  ) {}

  async mark(videoId: string, dto: MarkCaseDto, user: AuthenticatedUser, meta: RequestMeta) {
    if (!uuidPattern.test(videoId)) throw new NotFoundException('Video not found.');
    const video = await this.prisma.video.findUnique({ where: { id: videoId } });
    if (!video) throw new NotFoundException('Video not found.');
    await this.permissions.assertCanMarkCase(user, video, meta);
    const reason = dto.reason.trim();
    if (htmlPattern.test(reason)) throw new BadRequestException('Case reason must not contain HTML.');

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
      const lockedVideo = await transaction.video.findUnique({ where: { id: videoId } });
      if (!lockedVideo) throw new NotFoundException('Video not found.');
      await this.permissions.assertCanMarkCase(user, lockedVideo, meta);
      if (!finalStatuses.has(lockedVideo.status)) throw new ConflictException('Only finalized videos can be marked as cases.');

      const evaluation = await transaction.finalVideoEvaluation.findFirst({ where: { id: dto.evaluationId, videoId } });
      const latest = await transaction.finalVideoEvaluation.findFirst({
        where: { videoId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true },
      });
      if (!evaluation || latest?.id !== evaluation.id || !evaluation.confirmedAt || !evaluation.finalGrade || !evaluation.finalStatus) {
        throw new ConflictException('Only the confirmed latest final evaluation can be marked.');
      }
      if (dto.caseType === 'excellent' && evaluation.finalGrade !== 'effective') {
        throw new BadRequestException('Only effective videos can be marked as excellent cases.');
      }
      if (dto.caseType === 'negative' && evaluation.finalGrade !== 'invalid') {
        throw new BadRequestException('Only invalid videos can be marked as negative cases.');
      }
      if (evaluation.finalGrade === 'low_effective' && dto.caseType !== 'none') {
        throw new BadRequestException('Low-effective videos cannot enter a case library.');
      }

      const before = {
        isExcellentCase: evaluation.isExcellentCase,
        isNegativeCase: evaluation.isNegativeCase,
        caseNote: evaluation.caseNote,
      };
      const isExcellentCase = dto.caseType === 'excellent';
      const isNegativeCase = dto.caseType === 'negative';
      const markedAt = new Date();
      const updated = await transaction.finalVideoEvaluation.update({
        where: { id: evaluation.id },
        data: {
          isExcellentCase,
          isNegativeCase,
          caseMarkedById: user.id,
          caseMarkedAt: markedAt,
          caseNote: reason,
        },
        include: { caseMarker: { select: { id: true, name: true, account: true, role: true } } },
      });
      const actionType = dto.caseType === 'excellent'
        ? OperationLogAction.ExcellentCaseMarked
        : dto.caseType === 'negative'
          ? OperationLogAction.NegativeCaseMarked
          : OperationLogAction.CaseMarkRemoved;
      await this.operationLogs.create({
        userId: user.id, videoId, targetType: 'final_video_evaluation', targetId: evaluation.id,
        actionType, result: 'success', beforeValue: before,
        afterValue: { isExcellentCase, isNegativeCase, caseType: dto.caseType, reason },
        comment: dto.caseType === 'none' ? 'Case mark removed.' : `${dto.caseType} case marked.`,
        ipAddress: meta.ipAddress, userAgent: meta.userAgent,
      }, transaction);
      return {
        evaluationId: updated.id,
        videoId,
        caseType: dto.caseType,
        isExcellentCase: updated.isExcellentCase,
        isNegativeCase: updated.isNegativeCase,
        caseMarkedBy: updated.caseMarker,
        caseMarkedAt: updated.caseMarkedAt?.toISOString() || null,
        caseNote: updated.caseNote,
        videoStatus: lockedVideo.status,
      };
    });
  }

  async list(query: CaseListQueryDto, user: AuthenticatedUser) {
    const startDate = query.startDate ? shanghaiDayBoundary(query.startDate, false) : undefined;
    const endDate = query.endDate ? shanghaiDayBoundary(query.endDate, true) : undefined;
    if (startDate && endDate && startDate > endDate) throw new BadRequestException('startDate must not be after endDate.');
    const cursor = query.cursor ? await this.prisma.finalVideoEvaluation.findFirst({
      where: { id: query.cursor }, select: { id: true, caseMarkedAt: true },
    }) : null;
    if (query.cursor && (!cursor || !cursor.caseMarkedAt)) throw new BadRequestException('Case cursor is invalid.');
    const visibility = this.permissions.buildVideoVisibilityWhere(user);
    const records = await this.prisma.finalVideoEvaluation.findMany({
      where: {
        confirmedAt: { not: null },
        ...(query.type === 'excellent'
          ? { isExcellentCase: true, finalGrade: 'effective' }
          : { isNegativeCase: true, finalGrade: 'invalid' }),
        ...(cursor?.caseMarkedAt ? { OR: [
          { caseMarkedAt: { lt: cursor.caseMarkedAt } },
          { caseMarkedAt: cursor.caseMarkedAt, id: { lt: cursor.id } },
        ] } : {}),
        video: { AND: [
          visibility,
          {
            ...(query.brand ? { brand: query.brand.trim() } : {}),
            ...(query.platform ? { platform: query.platform.trim() } : {}),
            ...(query.videoType ? { videoType: query.videoType as VideoType } : {}),
            ...(query.creatorId ? { creatorId: query.creatorId } : {}),
          },
        ] },
        ...(startDate || endDate ? { caseMarkedAt: {
          ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lte: endDate } : {}),
        } } : {}),
      },
      orderBy: [{ caseMarkedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: {
        video: { select: {
          id: true, title: true, brand: true, product: true, platform: true, videoType: true,
          status: true, creator: { select: { id: true, name: true, account: true } },
        } },
        caseMarker: { select: { id: true, name: true, account: true } },
      },
    });
    const hasMore = records.length > query.limit;
    const page = records.slice(0, query.limit);
    return {
      items: page.map((item) => ({
        evaluationId: item.id,
        videoId: item.video.id,
        title: item.video.title,
        brand: item.video.brand,
        product: item.video.product,
        platform: item.video.platform,
        videoType: item.video.videoType,
        creator: item.video.creator,
        contentGrade: item.contentGrade,
        dataGrade: item.dataGrade,
        finalGrade: item.finalGrade,
        finalStatus: item.finalStatus,
        recommendedFinalGrade: item.recommendedFinalGrade,
        recommendationConfidence: item.recommendationConfidence,
        finalSuggestion: item.finalSuggestion,
        caseNote: item.caseNote,
        caseMarkedAt: item.caseMarkedAt?.toISOString() || null,
        caseMarkedBy: item.caseMarker,
        confirmedAt: item.confirmedAt?.toISOString() || null,
      })),
      nextCursor: hasMore ? page.at(-1)?.id || null : null,
    };
  }

  async export(query: CaseListQueryDto, user: AuthenticatedUser, meta: RequestMeta) {
    const result = await this.list({ ...query, cursor: undefined, limit: Math.min(query.limit || exportLimit, exportLimit) }, user);
    const rows: unknown[][] = [[
      '视频ID', '标题', '品牌', '平台', '视频类型', '创作人', '内容等级', '数据等级', '最终等级', '案例说明', '标记人', '标记时间（北京时间）',
    ], ...result.items.map((item) => [
      item.videoId, item.title, item.brand, item.platform, item.videoType, item.creator.name,
      item.contentGrade, item.dataGrade, item.finalGrade, item.caseNote, item.caseMarkedBy?.name, shanghaiDateTime(item.caseMarkedAt),
    ])];
    await this.operationLogs.create({
      userId: user.id, targetType: 'case_library', actionType: OperationLogAction.CaseLibraryExported,
      result: 'success', afterValue: { type: query.type, count: result.items.length, maximum: exportLimit },
      comment: 'Authorized case library export.', ...meta,
    });
    return { filename: `${query.type}-cases.csv`, content: rowsToCsv(rows) };
  }
}
