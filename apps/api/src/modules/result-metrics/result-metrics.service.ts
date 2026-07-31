import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, VideoStatus } from '@prisma/client';
import {
  getResultMetricFieldConfig,
  resultMetricDataFields,
  resultMetricFieldDefinitions,
  ResultMetricField,
} from '@ai-video-qc/shared';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { OperationLogAction } from '../operation-logs/operation-log-actions';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateResultMetricSnapshotDto } from './dto/create-result-metric-snapshot.dto';
import { ResultMetricHistoryQueryDto } from './dto/result-metric-history-query.dto';

type RequestMeta = { ipAddress?: string; userAgent?: string };
type MetricValue = string | number | Date | Prisma.Decimal | null;
type MetricValues = Partial<Record<ResultMetricField, MetricValue>>;

const allowedStatuses = new Set<VideoStatus>([
  VideoStatus.approved_for_publish,
  VideoStatus.pending_result_data,
  VideoStatus.ai_result_failed,
  VideoStatus.pending_data,
]);

const decimalKinds = new Set(['money2', 'decimal4', 'percentage', 'roi']);

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

@Injectable()
export class ResultMetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionsService: PermissionsService,
    private readonly operationLogsService: OperationLogsService,
  ) {}

  async createSnapshot(
    videoId: string,
    dto: CreateResultMetricSnapshotDto,
    user: AuthenticatedUser,
    requestMeta: RequestMeta,
  ) {
    const video = await this.findVideo(videoId);
    await this.permissionsService.assertCanSubmitResultMetrics(user, video, requestMeta);

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`,
      );
      const lockedVideo = await transaction.video.findUnique({ where: { id: videoId } });
      if (!lockedVideo) throw new NotFoundException('Video not found.');
      if (!allowedStatuses.has(lockedVideo.status)) {
        throw new ConflictException('Video status does not allow result metric submission.');
      }

      const latest = await transaction.videoResultMetric.findFirst({
        where: { videoId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      this.assertBaseMetric(dto.baseMetricId, latest?.id);

      const config = getResultMetricFieldConfig(lockedVideo.videoType, lockedVideo.isForAds);
      const suppliedFields = Object.keys(dto).filter(
        (key): key is ResultMetricField =>
          key !== 'baseMetricId' &&
          Object.prototype.hasOwnProperty.call(dto, key) &&
          dto[key as keyof CreateResultMetricSnapshotDto] !== undefined,
      );
      const disallowedFields = suppliedFields.filter((field) => !config.fields.includes(field));
      if (disallowedFields.length > 0) {
        throw new BadRequestException(
          `Fields are not allowed for this video type: ${disallowedFields.join(', ')}.`,
        );
      }

      const merged = this.mergeSnapshot(latest, dto, config.fields);
      this.validateCompleteSnapshot(merged, config.coreFields);
      const originalStatus = lockedVideo.status;
      const created = await transaction.videoResultMetric.create({
        data: {
          videoId,
          videoType: lockedVideo.videoType,
          submittedBy: user.id,
          ...merged,
        } as Prisma.VideoResultMetricUncheckedCreateInput,
        include: {
          submitter: { select: { id: true, name: true, account: true, role: true } },
        },
      });
      await transaction.video.update({
        where: { id: videoId },
        data: { status: VideoStatus.pending_result_data },
      });

      await this.operationLogsService.create({
        userId: user.id,
        videoId,
        targetType: 'video_result_metric',
        targetId: created.id,
        actionType: OperationLogAction.ResultMetricSnapshotCreated,
        result: 'success',
        beforeValue: {
          previousMetricId: latest?.id ?? null,
          videoStatus: originalStatus,
        },
        afterValue: {
          newMetricId: created.id,
          changedFields: suppliedFields,
          videoStatus: VideoStatus.pending_result_data,
          dataStartDate: this.dateForLog(created.dataStartDate),
          dataEndDate: this.dateForLog(created.dataEndDate),
        },
        comment: 'Result metric snapshot created.',
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      }, transaction);

      return this.toResponse(
        created,
        latest?.id ?? null,
        VideoStatus.pending_result_data,
        this.buildWarnings(merged),
      );
    });
  }

  async latest(videoId: string, user: AuthenticatedUser, requestMeta: RequestMeta) {
    const video = await this.findVideo(videoId);
    await this.permissionsService.assertCanAccessVideo(user, video, {
      ...requestMeta,
      action: 'Result metric access denied.',
    });
    const snapshots = await this.prisma.videoResultMetric.findMany({
      where: { videoId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 2,
      include: {
        submitter: { select: { id: true, name: true, account: true, role: true } },
      },
    });
    if (!snapshots[0]) return null;
    return this.toResponse(
      snapshots[0],
      snapshots[1]?.id ?? null,
      video.status,
      this.buildWarnings(snapshots[0] as MetricValues),
    );
  }

  async history(
    videoId: string,
    query: ResultMetricHistoryQueryDto,
    user: AuthenticatedUser,
    requestMeta: RequestMeta,
  ): Promise<{
    items: Array<Record<string, any> & { isLatest: boolean }>;
    nextCursor: string | null;
  }> {
    const video = await this.findVideo(videoId);
    await this.permissionsService.assertCanAccessVideo(user, video, {
      ...requestMeta,
      action: 'Result metric history access denied.',
    });
    const cursorMetric = query.cursor
      ? await this.prisma.videoResultMetric.findFirst({
          where: { id: query.cursor, videoId },
          select: { id: true, createdAt: true },
        })
      : null;
    if (query.cursor && !cursorMetric) {
      throw new BadRequestException('Result metric history cursor is invalid.');
    }

    const limit = query.limit || 20;
    const items = await this.prisma.videoResultMetric.findMany({
      where: {
        videoId,
        ...(cursorMetric
          ? {
              OR: [
                { createdAt: { lt: cursorMetric.createdAt } },
                { createdAt: cursorMetric.createdAt, id: { lt: cursorMetric.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        submitter: { select: { id: true, name: true, account: true, role: true } },
      },
    });
    const hasMore = items.length > limit;
    const page = items.slice(0, limit);
    const latest = await this.prisma.videoResultMetric.findFirst({
      where: { videoId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    return {
      items: page.map((item) => ({
        ...this.toResponse(item, null, video.status, this.buildWarnings(item as MetricValues)),
        isLatest: item.id === latest?.id,
      })),
      nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    };
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

  private assertBaseMetric(baseMetricId: string | null | undefined, latestMetricId?: string) {
    if (!latestMetricId && baseMetricId) {
      throw new ConflictException('Result data has changed. Reload before submitting.');
    }
    if (latestMetricId && baseMetricId !== latestMetricId) {
      throw new ConflictException('Result data has changed. Reload before submitting.');
    }
  }

  private mergeSnapshot(
    latest: Record<string, unknown> | null,
    dto: CreateResultMetricSnapshotDto,
    allowedFields: ResultMetricField[],
  ) {
    const merged: MetricValues = {};
    for (const field of allowedFields) {
      const dtoValue = dto[field as keyof CreateResultMetricSnapshotDto];
      const requested =
        Object.prototype.hasOwnProperty.call(dto, field) && dtoValue !== undefined
        ? dto[field as keyof CreateResultMetricSnapshotDto]
        : latest?.[field];
      merged[field] = this.normalizeField(field, requested);
    }
    return merged;
  }

  private normalizeField(field: ResultMetricField, value: unknown): MetricValue {
    if (value === null || value === undefined || value === '') return null;
    const definition = resultMetricFieldDefinitions[field];
    if (definition.kind === 'text') {
      if (typeof value !== 'string') throw new BadRequestException(`${field} must be text.`);
      return value.trim() || null;
    }
    if (definition.kind === 'url') {
      if (typeof value !== 'string') throw new BadRequestException(`${field} must be a URL.`);
      try {
        const url = new URL(value.trim());
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsafe protocol');
        return url.toString();
      } catch {
        throw new BadRequestException(`${field} must use http or https.`);
      }
    }
    if (definition.kind === 'date') {
      if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new BadRequestException(`${field} must be an ISO 8601 date.`);
      }
      const date = new Date(`${value}T00:00:00.000Z`);
      if (
        Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== value
      ) {
        throw new BadRequestException(`${field} must be an ISO 8601 date.`);
      }
      return date;
    }
    if (definition.kind === 'count') {
      const count = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(count) || !Number.isInteger(count) || count < 0) {
        throw new BadRequestException(`${field} must be a non-negative integer.`);
      }
      return count;
    }

    let decimal: Prisma.Decimal;
    try {
      decimal = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(String(value));
    } catch {
      throw new BadRequestException(`${field} must be a finite non-negative number.`);
    }
    const scale = definition.kind === 'money2' ? 2 : 4;
    if (!decimal.isFinite() || decimal.isNegative() || decimal.decimalPlaces() > scale) {
      throw new BadRequestException(`${field} must be non-negative with at most ${scale} decimal places.`);
    }
    if (definition.kind === 'percentage' && decimal.greaterThan(100)) {
      throw new BadRequestException(`${field} must be between 0 and 100.`);
    }
    return decimal;
  }

  private validateCompleteSnapshot(merged: MetricValues, coreFields: ResultMetricField[]) {
    const start = merged.dataStartDate;
    const end = merged.dataEndDate;
    if (!(start instanceof Date) || !(end instanceof Date)) {
      throw new BadRequestException('dataStartDate and dataEndDate are required.');
    }
    if (start.getTime() > end.getTime()) {
      throw new BadRequestException('dataStartDate must be before or equal to dataEndDate.');
    }
    const publishDate = merged.publishDate;
    if (publishDate instanceof Date && publishDate.getTime() > end.getTime()) {
      throw new BadRequestException('publishDate must be before or equal to dataEndDate.');
    }
    if (!coreFields.some((field) => merged[field] !== null && merged[field] !== undefined)) {
      throw new BadRequestException('At least one core metric is required.');
    }
  }

  private buildWarnings(values: MetricValues) {
    const warnings: string[] = [];
    const number = (field: ResultMetricField) => {
      const value = values[field];
      return value === null || value === undefined ? null : Number(value);
    };
    this.addWarning(warnings, 'CTR', number('ctr'), this.safeDivide(number('clicks'), number('impressions'), 100));
    this.addWarning(warnings, 'CPC', number('cpc'), this.safeDivide(number('spend'), number('clicks')));
    this.addWarning(warnings, 'CPM', number('cpm'), this.safeDivide(number('spend'), number('impressions'), 1000));
    this.addWarning(warnings, 'ROI', number('roi'), this.safeDivide(number('gmv'), number('spend')));
    return warnings;
  }

  private safeDivide(numerator: number | null, denominator: number | null, multiplier = 1) {
    if (numerator === null || denominator === null || denominator === 0) return null;
    return (numerator / denominator) * multiplier;
  }

  private addWarning(warnings: string[], label: string, actual: number | null, expected: number | null) {
    if (actual === null || expected === null) return;
    const tolerance = Math.max(Math.abs(expected) * 0.05, 0.01);
    if (Math.abs(actual - expected) > tolerance) {
      warnings.push(`${label} 与基础指标计算结果存在明显差异，请核对平台口径。`);
    }
  }

  private toResponse(
    snapshot: Record<string, any>,
    previousMetricId: string | null,
    videoStatus: VideoStatus,
    dataWarnings: string[],
  ): Record<string, any> {
    const metrics: Record<string, unknown> = {};
    for (const field of resultMetricDataFields) {
      const value = snapshot[field];
      const kind = resultMetricFieldDefinitions[field].kind;
      metrics[field] =
        value === null || value === undefined
          ? null
          : decimalKinds.has(kind)
            ? value.toString()
            : kind === 'date'
              ? new Date(value).toISOString().slice(0, 10)
              : value;
    }
    return {
      id: snapshot.id,
      videoId: snapshot.videoId,
      videoType: snapshot.videoType,
      ...metrics,
      submittedBy: snapshot.submitter
        ? {
            id: snapshot.submitter.id,
            name: snapshot.submitter.name,
            account: snapshot.submitter.account,
            role: snapshot.submitter.role,
          }
        : null,
      createdAt: new Date(snapshot.createdAt).toISOString(),
      previousMetricId,
      videoStatus,
      dataWarnings,
    };
  }

  private dateForLog(value: Date | null) {
    return value ? value.toISOString() : null;
  }
}
