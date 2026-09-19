import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { resultMetricNumericFields } from '@ai-video-qc/shared';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { OperationLogAction } from '../operation-logs/operation-log-actions';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { SavePlatformBenchmarkDto } from './dto/save-platform-benchmark.dto';

type RequestMeta = { ipAddress?: string; userAgent?: string };
const metricNames = new Set<string>(resultMetricNumericFields);

@Injectable()
export class PlatformBenchmarksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationLogsService: OperationLogsService,
  ) {}

  async list() {
    const items = await this.prisma.platformBenchmark.findMany({
      orderBy: [{ enabled: 'desc' }, { platform: 'asc' }, { videoType: 'asc' }, { metricName: 'asc' }],
    });
    return { items: items.map((item) => this.toResponse(item)) };
  }

  async create(dto: SavePlatformBenchmarkDto, user: AuthenticatedUser, meta: RequestMeta) {
    this.assertValid(dto);
    return this.prisma.$transaction(async (transaction) => {
      await this.assertAdministrator(transaction, user.id);
      await this.assertNoDuplicate(transaction, dto);
      const created = await transaction.platformBenchmark.create({ data: this.toData(dto) });
      await transaction.configurationRevision.create({ data: { kind: 'benchmark', targetId: created.id, version: 1, value: this.toResponse(created), actorId: user.id, reason: 'Platform benchmark created.' } });
      await this.operationLogsService.create({
        userId: user.id,
        targetType: 'platform_benchmark',
        targetId: created.id,
        actionType: OperationLogAction.PlatformBenchmarkCreated,
        result: 'success',
        afterValue: this.toResponse(created),
        comment: 'Platform benchmark created.',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      }, transaction);
      return this.toResponse(created);
    });
  }

  async replace(id: string, dto: SavePlatformBenchmarkDto, user: AuthenticatedUser, meta: RequestMeta) {
    this.assertValid(dto);
    return this.prisma.$transaction(async (transaction) => {
      await this.assertAdministrator(transaction, user.id);
      await transaction.$queryRaw(Prisma.sql`SELECT id FROM platform_benchmarks WHERE id = ${id}::uuid FOR UPDATE`);
      const existing = await transaction.platformBenchmark.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Platform benchmark not found.');
      await this.assertNoDuplicate(transaction, dto, id);
      let previous = await transaction.configurationRevision.findFirst({ where: { kind: 'benchmark', targetId: id }, orderBy: { version: 'desc' } });
      if (!previous) previous = await transaction.configurationRevision.create({ data: { kind: 'benchmark', targetId: id, version: 1, value: this.toResponse(existing), actorId: user.id, reason: 'Existing benchmark baseline captured before first versioned edit.' } });
      const updated = await transaction.platformBenchmark.update({ where: { id }, data: this.toData(dto) });
      await transaction.configurationRevision.create({ data: { kind: 'benchmark', targetId: id, version: previous.version + 1, value: this.toResponse(updated), actorId: user.id, reason: 'Platform benchmark updated.' } });
      await this.operationLogsService.create({
        userId: user.id,
        targetType: 'platform_benchmark',
        targetId: id,
        actionType: OperationLogAction.PlatformBenchmarkUpdated,
        result: 'success',
        beforeValue: this.toResponse(existing),
        afterValue: this.toResponse(updated),
        comment: 'Platform benchmark updated.',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      }, transaction);
      return this.toResponse(updated);
    });
  }

  private assertValid(dto: SavePlatformBenchmarkDto) {
    if (!dto.platform?.trim()) throw new BadRequestException('platform is required.');
    if (!metricNames.has(dto.metricName)) throw new BadRequestException('Unsupported benchmark metric.');
    const values = [dto.sThreshold, dto.aThreshold, dto.bThreshold, dto.cThreshold];
    const ordered = dto.direction === 'higher_is_better'
      ? values.every((value, index) => index === 0 || values[index - 1] >= value)
      : values.every((value, index) => index === 0 || values[index - 1] <= value);
    if (!ordered) {
      throw new BadRequestException(
        dto.direction === 'higher_is_better'
          ? 'Higher-is-better thresholds must satisfy S ≥ A ≥ B ≥ C.'
          : 'Lower-is-better thresholds must satisfy S ≤ A ≤ B ≤ C.',
      );
    }
  }
  private async assertAdministrator(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`);
    const actor = await tx.user.findUnique({ where: { id } });
    if (!actor || actor.role !== 'admin' || actor.status !== 'active' || actor.mustChangePassword || (actor.expiresAt && +actor.expiresAt <= Date.now())) throw new ForbiddenException('Administrator is no longer active.');
  }

  private async assertNoDuplicate(
    transaction: Prisma.TransactionClient,
    dto: SavePlatformBenchmarkDto,
    excludedId?: string,
  ) {
    const duplicate = await transaction.platformBenchmark.findFirst({
      where: {
        platform: dto.platform.trim(),
        brand: dto.brand?.trim() || null,
        videoType: dto.videoType,
        metricName: dto.metricName,
        ...(excludedId ? { id: { not: excludedId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) throw new ConflictException('The same platform benchmark already exists.');
  }

  private toData(dto: SavePlatformBenchmarkDto): Prisma.PlatformBenchmarkUncheckedCreateInput {
    return {
      platform: dto.platform.trim(),
      brand: dto.brand?.trim() || null,
      videoType: dto.videoType,
      metricName: dto.metricName,
      sThreshold: new Prisma.Decimal(String(dto.sThreshold)),
      aThreshold: new Prisma.Decimal(String(dto.aThreshold)),
      bThreshold: new Prisma.Decimal(String(dto.bThreshold)),
      cThreshold: new Prisma.Decimal(String(dto.cThreshold)),
      direction: dto.direction,
      enabled: dto.enabled ?? true,
    };
  }

  private toResponse(item: Record<string, any>) {
    return {
      id: item.id,
      platform: item.platform,
      brand: item.brand,
      videoType: item.videoType,
      metricName: item.metricName,
      sThreshold: item.sThreshold?.toString() ?? null,
      aThreshold: item.aThreshold?.toString() ?? null,
      bThreshold: item.bThreshold?.toString() ?? null,
      cThreshold: item.cThreshold?.toString() ?? null,
      direction: item.direction,
      enabled: item.enabled,
      createdAt: new Date(item.createdAt).toISOString(),
      updatedAt: new Date(item.updatedAt).toISOString(),
    };
  }
}
