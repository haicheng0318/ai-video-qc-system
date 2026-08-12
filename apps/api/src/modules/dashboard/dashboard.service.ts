import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardBreakdownQueryDto, DashboardQueryDto, DashboardTrendQueryDto } from './dto/dashboard-query.dto';

type Period = { startDate: Date; endDate: Date };
type AggregateRow = Record<string, bigint | number | string | null>;

function period(query: DashboardQueryDto): Period {
  const endDate = query.endDate ? new Date(query.endDate) : new Date();
  endDate.setUTCHours(23, 59, 59, 999);
  const startDate = query.startDate ? new Date(query.startDate) : new Date(endDate);
  if (!query.startDate) startDate.setUTCDate(startDate.getUTCDate() - 29);
  startDate.setUTCHours(0, 0, 0, 0);
  if (startDate > endDate) throw new BadRequestException('startDate must not be after endDate.');
  return { startDate, endDate };
}

function count(value: unknown) {
  return Number(value || 0);
}

function rate(numerator: number, denominator: number) {
  return denominator === 0 ? null : Number(((numerator / denominator) * 100).toFixed(2));
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private visibility(user: AuthenticatedUser) {
    const fullVisibility = new Set<UserRole>([
      UserRole.admin, UserRole.content_owner, UserRole.operator, UserRole.advertiser,
    ]);
    if (fullVisibility.has(user.role)) {
      return Prisma.empty;
    }
    if (user.role === UserRole.supervisor) {
      return Prisma.sql`AND (v.creator_id = ${user.id}::uuid OR creator.manager_id = ${user.id}::uuid)`;
    }
    return Prisma.sql`AND v.creator_id = ${user.id}::uuid`;
  }

  private filters(query: DashboardQueryDto, user: AuthenticatedUser) {
    return Prisma.sql`
      ${this.visibility(user)}
      ${query.brand ? Prisma.sql`AND v.brand = ${query.brand.trim()}` : Prisma.empty}
      ${query.platform ? Prisma.sql`AND v.platform = ${query.platform.trim()}` : Prisma.empty}
      ${query.videoType ? Prisma.sql`AND v.video_type = ${query.videoType}::"VideoType"` : Prisma.empty}
      ${query.creatorId ? Prisma.sql`AND v.creator_id = ${query.creatorId}::uuid` : Prisma.empty}
    `;
  }

  async summary(query: DashboardQueryDto, user: AuthenticatedUser) {
    const selectedPeriod = period(query);
    const filters = this.filters(query, user);
    const [rows, pipeline = {}] = await Promise.all([
      this.prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
        SELECT
          COUNT(*) AS finalized,
          COUNT(*) FILTER (WHERE f.final_grade = 'effective') AS effective,
          COUNT(*) FILTER (WHERE f.final_grade = 'low_effective') AS low_effective,
          COUNT(*) FILTER (WHERE f.final_grade = 'invalid') AS invalid,
          COUNT(*) FILTER (WHERE f.final_grade IN ('effective', 'low_effective')) AS effective_output,
          COUNT(*) FILTER (WHERE f.can_be_used_for_performance) AS performance_eligible,
          COUNT(*) FILTER (WHERE f.is_excellent_case) AS excellent_cases,
          COUNT(*) FILTER (WHERE f.is_negative_case) AS negative_cases,
          COUNT(*) FILTER (WHERE f.final_grade = f.recommended_final_grade) AS gpt_matched,
          COUNT(*) FILTER (WHERE f.final_grade <> f.recommended_final_grade) AS manually_adjusted
        FROM final_video_evaluations f
        JOIN videos v ON v.id = f.video_id
        JOIN users creator ON creator.id = v.creator_id
        WHERE f.confirmed_at BETWEEN ${selectedPeriod.startDate} AND ${selectedPeriod.endDate}
          AND f.final_grade IS NOT NULL
          AND f.final_status IS NOT NULL
          AND f.is_effective_final IS NOT NULL
          ${filters}
      `),
      this.prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
        SELECT
          COUNT(*) FILTER (WHERE v.status = 'pending_data') AS pending_data,
          COUNT(*) FILTER (WHERE v.status = 'pending_final_evaluation') AS pending_final_evaluation,
          COUNT(*) FILTER (WHERE v.status = 'final_evaluation_failed') AS final_evaluation_failed,
          COUNT(*) FILTER (WHERE v.status = 'pending_final_confirmation') AS pending_final_confirmation
        FROM videos v
        JOIN users creator ON creator.id = v.creator_id
        WHERE TRUE ${filters}
      `).then((rows) => rows[0] || {}),
    ]);
    const row: AggregateRow = rows[0] || {};
    const finalized = count(row.finalized);
    const effective = count(row.effective);
    const lowEffective = count(row.low_effective);
    const invalid = count(row.invalid);
    const effectiveOutput = count(row.effective_output);
    const performanceEligible = count(row.performance_eligible);
    const gptMatched = count(row.gpt_matched);
    return {
      period: { startDate: selectedPeriod.startDate.toISOString(), endDate: selectedPeriod.endDate.toISOString() },
      finalizedCount: finalized,
      finalEffectiveCount: effective,
      finalLowEffectiveCount: lowEffective,
      finalInvalidCount: invalid,
      effectiveOutputCount: effectiveOutput,
      effectiveOutputRate: rate(effectiveOutput, finalized),
      finalEffectiveRate: rate(effective, finalized),
      lowEffectiveRate: rate(lowEffective, finalized),
      invalidRate: rate(invalid, finalized),
      performanceEligibleCount: performanceEligible,
      performanceEligibleRate: rate(performanceEligible, finalized),
      excellentCaseCount: count(row.excellent_cases),
      negativeCaseCount: count(row.negative_cases),
      gptRecommendationMatchedCount: gptMatched,
      gptMatchRate: rate(gptMatched, finalized),
      manualAdjustedCount: count(row.manually_adjusted),
      manualAdjustmentRate: rate(count(row.manually_adjusted), finalized),
      pipeline: {
        pendingDataCount: count(pipeline.pending_data),
        pendingFinalEvaluationCount: count(pipeline.pending_final_evaluation),
        finalEvaluationFailedCount: count(pipeline.final_evaluation_failed),
        pendingFinalConfirmationCount: count(pipeline.pending_final_confirmation),
      },
    };
  }

  async trend(query: DashboardTrendQueryDto, user: AuthenticatedUser) {
    const selectedPeriod = period(query);
    const bucket = query.granularity === 'week'
      ? Prisma.sql`date_trunc('week', f.confirmed_at)`
      : Prisma.sql`date_trunc('day', f.confirmed_at)`;
    const rows = await this.prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
      SELECT ${bucket} AS bucket,
        COUNT(*) AS finalized,
        COUNT(*) FILTER (WHERE f.final_grade = 'effective') AS effective,
        COUNT(*) FILTER (WHERE f.final_grade = 'low_effective') AS low_effective,
        COUNT(*) FILTER (WHERE f.final_grade = 'invalid') AS invalid
      FROM final_video_evaluations f
      JOIN videos v ON v.id = f.video_id
      JOIN users creator ON creator.id = v.creator_id
      WHERE f.confirmed_at BETWEEN ${selectedPeriod.startDate} AND ${selectedPeriod.endDate}
        AND f.final_grade IS NOT NULL
        AND f.final_status IS NOT NULL
        AND f.is_effective_final IS NOT NULL
        ${this.filters(query, user)}
      GROUP BY 1 ORDER BY 1 ASC
    `);
    return {
      period: { startDate: selectedPeriod.startDate.toISOString(), endDate: selectedPeriod.endDate.toISOString() },
      granularity: query.granularity,
      items: rows.map((row) => ({
        bucket: new Date(String(row.bucket)).toISOString(),
        finalizedCount: count(row.finalized),
        effectiveCount: count(row.effective),
        lowEffectiveCount: count(row.low_effective),
        invalidCount: count(row.invalid),
        effectiveOutputRate: rate(count(row.effective) + count(row.low_effective), count(row.finalized)),
      })),
    };
  }

  async breakdown(query: DashboardBreakdownQueryDto, user: AuthenticatedUser) {
    const selectedPeriod = period(query);
    const groupKey = query.groupBy === 'brand' ? Prisma.sql`COALESCE(v.brand, '')`
      : query.groupBy === 'platform' ? Prisma.sql`COALESCE(v.platform, '')`
        : query.groupBy === 'videoType' ? Prisma.sql`v.video_type::text`
          : Prisma.sql`creator.id::text`;
    const groupLabel = query.groupBy === 'brand' ? Prisma.sql`COALESCE(v.brand, '未填写')`
      : query.groupBy === 'platform' ? Prisma.sql`COALESCE(v.platform, '未填写')`
        : query.groupBy === 'videoType' ? Prisma.sql`v.video_type::text`
          : Prisma.sql`creator.name`;
    const rows = await this.prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
      SELECT ${groupKey} AS group_key, ${groupLabel} AS group_label,
        COUNT(*) AS finalized,
        COUNT(*) FILTER (WHERE f.final_grade = 'effective') AS effective,
        COUNT(*) FILTER (WHERE f.final_grade = 'low_effective') AS low_effective,
        COUNT(*) FILTER (WHERE f.final_grade = 'invalid') AS invalid,
        COUNT(*) FILTER (WHERE f.can_be_used_for_performance) AS performance_eligible,
        COUNT(*) FILTER (WHERE f.is_excellent_case) AS excellent_cases,
        COUNT(*) FILTER (WHERE f.is_negative_case) AS negative_cases,
        COUNT(*) FILTER (WHERE f.final_grade <> f.recommended_final_grade) AS manually_adjusted
      FROM final_video_evaluations f
      JOIN videos v ON v.id = f.video_id
      JOIN users creator ON creator.id = v.creator_id
      WHERE f.confirmed_at BETWEEN ${selectedPeriod.startDate} AND ${selectedPeriod.endDate}
        AND f.final_grade IS NOT NULL
        AND f.final_status IS NOT NULL
        AND f.is_effective_final IS NOT NULL
        ${this.filters(query, user)}
      GROUP BY 1, 2 ORDER BY finalized DESC, group_label ASC
    `);
    return {
      period: { startDate: selectedPeriod.startDate.toISOString(), endDate: selectedPeriod.endDate.toISOString() },
      groupBy: query.groupBy,
      items: rows.map((row) => {
        const finalized = count(row.finalized);
        const effective = count(row.effective);
        return {
          groupKey: String(row.group_key),
          groupLabel: String(row.group_label),
          finalizedCount: finalized,
          effectiveCount: effective,
          lowEffectiveCount: count(row.low_effective),
          invalidCount: count(row.invalid),
          effectiveOutputCount: effective + count(row.low_effective),
          effectiveOutputRate: rate(effective + count(row.low_effective), finalized),
          performanceEligibleCount: count(row.performance_eligible),
          excellentCaseCount: count(row.excellent_cases),
          negativeCaseCount: count(row.negative_cases),
          manualAdjustedCount: count(row.manually_adjusted),
        };
      }),
    };
  }
}
