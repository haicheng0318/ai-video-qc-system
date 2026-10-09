import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardBreakdownQueryDto, DashboardQueryDto, DashboardTrendQueryDto } from './dto/dashboard-query.dto';

type Period = { startDate: Date; endDate: Date };
type AggregateRow = Record<string, bigint | number | string | null>;

function period(query: DashboardQueryDto): Period {
  const parts = (value?: string) => {
    if (value) {
      const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
      if (!match) throw new BadRequestException('Dashboard dates must use an ISO calendar date.');
      const result = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
      const checked = new Date(Date.UTC(result.year, result.month - 1, result.day));
      if (checked.getUTCFullYear() !== result.year || checked.getUTCMonth() !== result.month - 1 || checked.getUTCDate() !== result.day) throw new BadRequestException('Dashboard date is invalid.');
      return result;
    }
    const shanghaiNow = new Date(Date.now() + 8 * 3600000);
    return { year: shanghaiNow.getUTCFullYear(), month: shanghaiNow.getUTCMonth() + 1, day: shanghaiNow.getUTCDate() };
  };
  const end = parts(query.endDate);
  const endDate = new Date(Date.UTC(end.year, end.month - 1, end.day + 1) - 8 * 3600000 - 1);
  const start = query.startDate ? parts(query.startDate) : (() => { const value = new Date(endDate.getTime() - 29 * 86400000); const shifted = new Date(value.getTime() + 8 * 3600000); return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }; })();
  const startDate = new Date(Date.UTC(start.year, start.month - 1, start.day) - 8 * 3600000);
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
    return user.role === UserRole.admin ? Prisma.empty : Prisma.sql`AND v.creator_id = ${user.id}::uuid`;
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
    const [rows, pipeline = {}, v11Rows] = await Promise.all([
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
          AND v.is_trial = false
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
        WHERE v.is_trial = false ${filters}
      `).then((rows) => rows[0] || {}),
      this.prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
        WITH latest AS (
          SELECT DISTINCT ON (c.video_id) c.*
          FROM v11_comprehensive_decisions c
          JOIN v11_workflow_revisions w ON w.id = c.workflow_revision_id
          WHERE c.final_status IS NOT NULL
            AND w.status = 'current'
          ORDER BY c.video_id, c.decision_revision DESC, c.decided_at DESC, c.id DESC
        )
        SELECT COUNT(*) AS finalized,
          COUNT(*) FILTER (WHERE comprehensive_rating IN ('S', 'A+', 'A', 'B')) AS effective,
          COUNT(*) FILTER (WHERE comprehensive_rating IN ('B-', 'C')) AS low_effective,
          COUNT(*) FILTER (WHERE comprehensive_rating = 'D') AS invalid,
          COUNT(*) FILTER (WHERE performance_eligible) AS performance_eligible,
          COUNT(*) FILTER (WHERE is_excellent_case) AS excellent_cases,
          COUNT(*) FILTER (WHERE is_negative_case) AS negative_cases
        FROM latest c
        JOIN videos v ON v.id = c.video_id
        JOIN users creator ON creator.id = v.creator_id
        WHERE c.decided_at BETWEEN ${selectedPeriod.startDate} AND ${selectedPeriod.endDate}
          AND v.is_trial = false ${filters}
      `),
    ]);
    const row: AggregateRow = rows[0] || {};
    const finalized = count(row.finalized);
    const effective = count(row.effective);
    const lowEffective = count(row.low_effective);
    const invalid = count(row.invalid);
    const effectiveOutput = count(row.effective_output);
    const performanceEligible = count(row.performance_eligible);
    const gptMatched = count(row.gpt_matched);
    const v11 = v11Rows[0] || {};
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
      v11: {
        finalizedCount: count(v11.finalized),
        effectiveCount: count(v11.effective),
        lowEffectiveCount: count(v11.low_effective),
        invalidCount: count(v11.invalid),
        performanceEligibleCount: count(v11.performance_eligible),
        excellentCaseCount: count(v11.excellent_cases),
        negativeCaseCount: count(v11.negative_cases),
      },
    };
  }

  async trend(query: DashboardTrendQueryDto, user: AuthenticatedUser) {
    const selectedPeriod = period(query);
    const bucket = query.granularity === 'week'
      ? Prisma.sql`date_trunc('week', f.confirmed_at + interval '8 hours') - interval '8 hours'`
      : Prisma.sql`date_trunc('day', f.confirmed_at + interval '8 hours') - interval '8 hours'`;
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
        AND v.is_trial = false
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
        AND v.is_trial = false
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
