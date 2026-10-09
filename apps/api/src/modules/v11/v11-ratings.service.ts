import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole, VideoStatus } from '@prisma/client';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { readPolicy } from '../admin/runtime-policy';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  approveBenchmarkSchema,
  benchmarkProfileInputSchema,
  confirmComprehensiveSchema,
  manualComprehensiveSchema,
  markV11CaseSchema,
} from './benchmark-schema';
import {
  businessOutcomeFor,
  comprehensiveRatingFor,
  resolveManualR,
  V11_COMPREHENSIVE_MATRIX_VERSION,
  V11ComprehensiveRating,
} from './comprehensive-matrix';
import {
  BenchmarkThresholds,
  calculateDataRating,
  GuardRule,
  validateThresholdOrder,
  V11_DATA_RATING_VERSION,
} from './data-rating-engine';
import { V11ContentRating } from './content-scoring';
import { evaluateFinalGate } from './gate-engine';

const FINAL_STATUS = {
  final_effective: VideoStatus.final_effective,
  final_low_effective: VideoStatus.final_low_effective,
  final_invalid: VideoStatus.final_invalid,
} as const;

function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: unknown } } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException({ message: 'Invalid request.', issues: result.error.issues });
  return result.data;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function metricValues(metric: Record<string, unknown>) {
  const excluded = new Set(['id', 'videoId', 'videoType', 'submittedBy', 'createdAt', 'updatedAt', 'video', 'submitter']);
  return Object.fromEntries(Object.entries(metric).filter(([key]) => !excluded.has(key)).map(([key, value]) => {
    if (value && typeof value === 'object' && 'toString' in value && value.constructor?.name === 'Decimal') return [key, value.toString()];
    return [key, value];
  }));
}

const contentRatings = new Set<V11ContentRating>(['A+', 'A', 'B', 'B-', 'C', 'D']);
const dataRatings = new Set<NonNullable<ReturnType<typeof calculateDataRating>['dataRating']>>(['S', 'A+', 'A', 'B', 'B-', 'C', 'D']);

function assertContentRating(value: string | null): asserts value is V11ContentRating {
  if (!value || !contentRatings.has(value as V11ContentRating)) throw new ConflictException('Current content rating is invalid.');
}

function assertDataRating(value: string | null): asserts value is NonNullable<ReturnType<typeof calculateDataRating>['dataRating']> {
  if (!value || !dataRatings.has(value as NonNullable<ReturnType<typeof calculateDataRating>['dataRating']>)) {
    throw new ConflictException('Current data rating is invalid.');
  }
}

@Injectable()
export class V11RatingsService {
  constructor(
    private readonly db: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly logs: OperationLogsService,
  ) {}

  async listProfiles() {
    return this.db.v11BenchmarkProfile.findMany({
      orderBy: [{ platform: 'asc' }, { brand: 'asc' }, { videoType: 'asc' }, { version: 'desc' }],
      include: { thresholds: true, createdBy: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } } },
    });
  }

  async createProfile(body: unknown, user: AuthenticatedUser) {
    const input = parse(benchmarkProfileInputSchema, body);
    const thresholds: BenchmarkThresholds = { metricName: input.primaryMetric, ...input.thresholds };
    try { validateThresholdOrder(thresholds); } catch (error) { throw new BadRequestException((error as Error).message); }
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${input.platform}|${input.brand ?? ''}|${input.videoType}`}))`);
      const latest = await tx.v11BenchmarkProfile.findFirst({
        where: { platform: input.platform, brand: input.brand ?? null, videoType: input.videoType },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const profile = await tx.v11BenchmarkProfile.create({
        data: {
          name: input.name, version: (latest?.version ?? 0) + 1, platform: input.platform,
          brand: input.brand ?? null, videoType: input.videoType, primaryMetric: input.primaryMetric,
          requiredMetrics: input.requiredMetrics, minimumSampleMetric: input.minimumSampleMetric,
          minimumSampleValue: new Prisma.Decimal(input.minimumSampleValue), observationWindowDays: input.observationWindowDays,
          guardRules: json(input.guardRules), createdById: user.id,
          thresholds: { create: {
            metricName: input.primaryMetric, direction: input.thresholds.direction,
            sThreshold: input.thresholds.S, aPlusThreshold: input.thresholds['A+'], aThreshold: input.thresholds.A,
            bThreshold: input.thresholds.B, bMinusThreshold: input.thresholds['B-'], cThreshold: input.thresholds.C,
          } },
        },
        include: { thresholds: true },
      });
      await this.logs.create({ userId: user.id, targetType: 'v11_benchmark_profile', targetId: profile.id, actionType: 'v11_benchmark_profile_created', result: 'success', afterValue: json({ version: profile.version, platform: profile.platform, brand: profile.brand, videoType: profile.videoType }) }, tx);
      return profile;
    });
  }

  async approveProfile(id: string, body: unknown, user: AuthenticatedUser) {
    const input = parse(approveBenchmarkSchema, body);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM v11_benchmark_profiles WHERE id = ${id}::uuid FOR UPDATE`);
      const profile = await tx.v11BenchmarkProfile.findUnique({ where: { id } });
      if (!profile) throw new NotFoundException('Benchmark profile not found.');
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${profile.platform}|${profile.brand ?? ''}|${profile.videoType}`}))`);
      await tx.v11BenchmarkProfile.updateMany({
        where: { platform: profile.platform, brand: profile.brand, videoType: profile.videoType, status: 'approved', enabled: true, id: { not: id } },
        data: { enabled: false },
      });
      const approved = await tx.v11BenchmarkProfile.update({ where: { id }, data: { status: 'approved', enabled: true, approvedById: user.id, approvedAt: new Date() }, include: { thresholds: true } });
      await this.logs.create({ userId: user.id, targetType: 'v11_benchmark_profile', targetId: id, actionType: 'v11_benchmark_profile_approved', result: 'success', comment: input.reason, afterValue: json({ version: approved.version, enabled: true }) }, tx);
      return approved;
    });
  }

  async rateData(videoId: string, user: AuthenticatedUser) {
    const visible = await this.permissions.findVideoVisibleToUser(videoId, user);
    if (!visible) throw new NotFoundException('Video not found.');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
      const video = await tx.video.findUnique({ where: { id: videoId } });
      if (!video) throw new NotFoundException('Video not found.');
      const workflow = await tx.v11WorkflowRevision.findFirst({ where: { videoId, status: 'current' }, orderBy: { revision: 'desc' } });
      if (!workflow?.activeContentDecisionId) throw new ConflictException('A current V1.1 content decision is required.');
      const metric = await tx.videoResultMetric.findFirst({ where: { videoId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      if (!metric) throw new ConflictException('A result metric snapshot is required.');
      const existing = await tx.v11DataRatingDecision.findUnique({ where: { workflowRevisionId_resultMetricId: { workflowRevisionId: workflow.id, resultMetricId: metric.id } } });
      if (existing) return existing;
      const profile = video.platform ? await tx.v11BenchmarkProfile.findFirst({
        where: { platform: video.platform, brand: video.brand ?? null, videoType: video.videoType, status: 'approved', enabled: true },
        orderBy: { version: 'desc' }, include: { thresholds: true },
      }) : null;
      const threshold = profile?.thresholds.find((item) => item.metricName === profile.primaryMetric) ?? null;
      const metrics = metricValues(metric as unknown as Record<string, unknown>);
      const calculated = calculateDataRating({
        metrics,
        thresholds: profile && threshold ? {
          metricName: threshold.metricName, direction: threshold.direction as BenchmarkThresholds['direction'],
          S: Number(threshold.sThreshold), 'A+': Number(threshold.aPlusThreshold), A: Number(threshold.aThreshold),
          B: Number(threshold.bThreshold), 'B-': Number(threshold.bMinusThreshold), C: Number(threshold.cThreshold),
        } : null,
        requiredMetrics: profile?.requiredMetrics ?? [], minimumSampleMetric: profile?.minimumSampleMetric ?? '__missing__',
        minimumSampleValue: Number(profile?.minimumSampleValue ?? 0), observationWindowDays: profile?.observationWindowDays ?? 1,
        dataStartDate: metric.dataStartDate, dataEndDate: metric.dataEndDate,
        guards: (profile?.guardRules ?? []) as unknown as GuardRule[],
      });
      const explanation = await tx.aiResultReview.findFirst({ where: { videoId, resultMetricId: metric.id, status: 'succeeded' }, orderBy: { createdAt: 'desc' }, select: { id: true } });
      const decision = await tx.v11DataRatingDecision.create({ data: {
        videoId, workflowRevisionId: workflow.id, resultMetricId: metric.id, benchmarkProfileId: profile?.id ?? null,
        dataRating: calculated.dataRating, dataSufficiency: calculated.dataSufficiency, ratingVersion: V11_DATA_RATING_VERSION,
        primaryMetric: profile?.primaryMetric ?? null,
        primaryMetricValue: calculated.dataSufficiency === 'sufficient' ? new Prisma.Decimal(calculated.primaryMetricValue) : null,
        guardApplications: json(calculated.guardApplications), explanationReviewId: explanation?.id ?? null,
      } });
      const nextStatus = calculated.dataSufficiency === 'sufficient' ? VideoStatus.pending_rule_engine : VideoStatus.pending_data;
      await tx.video.update({ where: { id: videoId }, data: { status: nextStatus } });
      await this.logs.create({ userId: user.id, videoId, targetType: 'v11_data_rating_decision', targetId: decision.id, actionType: 'v11_data_rating_decided', result: 'success', afterValue: json({ dataSufficiency: decision.dataSufficiency, dataRating: decision.dataRating, ratingVersion: decision.ratingVersion, reason: calculated.reason }) }, tx);
      return decision;
    });
  }

  async createComprehensiveDecision(videoId: string, user: AuthenticatedUser) {
    const visible = await this.permissions.findVideoVisibleToUser(videoId, user);
    if (!visible) throw new NotFoundException('Video not found.');
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
      const workflow = await tx.v11WorkflowRevision.findFirst({ where: { videoId, status: 'current' }, orderBy: { revision: 'desc' } });
      if (!workflow?.activeContentDecisionId) throw new ConflictException('A current V1.1 content decision is required.');
      const content = await tx.v11EvaluationDecision.findUnique({ where: { id: workflow.activeContentDecisionId } });
      const data = await tx.v11DataRatingDecision.findFirst({ where: { videoId, workflowRevisionId: workflow.id }, orderBy: { decidedAt: 'desc' } });
      if (!content || !data) throw new ConflictException('Current content and data decisions are required.');
      if (data.dataSufficiency !== 'sufficient' || !data.dataRating) throw new ConflictException('Insufficient data cannot produce a comprehensive rating.');
      if (!content.inputComplete || !content.contentRating) throw new ConflictException('Incomplete content input cannot produce a comprehensive rating.');
      const existing = await tx.v11ComprehensiveDecision.findFirst({ where: { workflowRevisionId: workflow.id, contentDecisionId: content.id, dataDecisionId: data.id, matrixVersion: V11_COMPREHENSIVE_MATRIX_VERSION }, orderBy: { decisionRevision: 'desc' } });
      if (existing) return existing;
      assertContentRating(content.contentRating);
      assertDataRating(data.dataRating);
      const result = comprehensiveRatingFor(content.contentRating, data.dataRating);
      const gates = await readPolicy(tx, 'v11_workflow_gates');
      const [activeHolds, activeAppeals] = await Promise.all([
        tx.v11WorkflowHold.count({ where: { workflowRevisionId: workflow.id, status: 'active' } }),
        tx.v11Appeal.count({ where: { workflowRevisionId: workflow.id, status: 'active' } }),
      ]);
      const gate = result.finalStatus ? evaluateFinalGate({
        manualEnabled: gates.manualFinalConfirmationEnabled,
        dataSufficient: data.dataSufficiency === 'sufficient',
        deterministicRuleClear: !result.requiresAdminReview,
        comprehensiveConsistent: content.stable && content.inputComplete,
        hasSafetyGate: activeHolds > 0 || activeAppeals > 0 || content.complianceStatus !== 'clear',
        finalStatus: result.finalStatus,
      }) : { decision: 'hold' as const, decisionSource: null, actorId: null, performanceEligible: false };
      const autoFinal = gate.decision === 'final_effective' || gate.decision === 'final_low_effective' || gate.decision === 'final_invalid';
      const decision = await tx.v11ComprehensiveDecision.create({ data: {
        videoId, workflowRevisionId: workflow.id, contentDecisionId: content.id, dataDecisionId: data.id,
        comprehensiveRating: result.comprehensiveRating, matrixVersion: V11_COMPREHENSIVE_MATRIX_VERSION,
        requiresAdminReview: result.requiresAdminReview, businessConclusion: autoFinal ? result.businessConclusion : null,
        finalStatus: autoFinal ? result.finalStatus : null, isEffectiveFinal: autoFinal ? result.isEffectiveFinal : null,
        performanceEligible: false, decisionSource: autoFinal ? 'system' : null,
        explanation: json({ contentRating: content.contentRating, dataRating: data.dataRating, automated: autoFinal, gateDecision: gate.decision }),
      } });
      await tx.video.update({ where: { id: videoId }, data: { status: autoFinal ? FINAL_STATUS[result.finalStatus as keyof typeof FINAL_STATUS] : VideoStatus.pending_final_confirmation } });
      if (autoFinal) await tx.v11WorkflowGateDecision.create({ data: { videoId, workflowRevisionId: workflow.id, stage: 'final_confirmation', decision: result.businessConclusion!, decisionSource: 'system', reason: 'V1.1 automatic final gate passed.', performanceEligible: false } });
      await this.logs.create({ userId: user.id, videoId, targetType: 'v11_comprehensive_decision', targetId: decision.id, actionType: 'v11_comprehensive_rating_decided', result: 'success', afterValue: json({ rating: decision.comprehensiveRating, requiresAdminReview: decision.requiresAdminReview, autoFinal }) }, tx);
      return decision;
    });
  }

  async resolveManualComprehensive(videoId: string, body: unknown, user: AuthenticatedUser) {
    const input = parse(manualComprehensiveSchema, body);
    const rating = resolveManualR(input.rating) as V11ComprehensiveRating;
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
      const previous = await tx.v11ComprehensiveDecision.findFirst({
        where: { videoId, workflowRevision: { status: 'current' } },
        orderBy: [{ decisionRevision: 'desc' }, { decidedAt: 'desc' }, { id: 'desc' }],
      });
      if (!previous?.requiresAdminReview) throw new ConflictException('No R decision is awaiting administrator review.');
      const [holds, appeals] = await Promise.all([
        tx.v11WorkflowHold.count({ where: { workflowRevisionId: previous.workflowRevisionId, status: 'active' } }),
        tx.v11Appeal.count({ where: { workflowRevisionId: previous.workflowRevisionId, status: 'active' } }),
      ]);
      if (holds || appeals) throw new ConflictException('Unresolved workflow safety gates block administrator resolution.');
      const outcome = businessOutcomeFor(rating);
      const gates = await readPolicy(tx, 'v11_workflow_gates');
      const decision = await tx.v11ComprehensiveDecision.create({ data: {
        videoId, workflowRevisionId: previous.workflowRevisionId, contentDecisionId: previous.contentDecisionId,
        dataDecisionId: previous.dataDecisionId, decisionRevision: previous.decisionRevision + 1,
        comprehensiveRating: rating, matrixVersion: previous.matrixVersion, requiresAdminReview: false,
        businessConclusion: gates.manualFinalConfirmationEnabled ? null : outcome.businessConclusion,
        finalStatus: gates.manualFinalConfirmationEnabled ? null : outcome.finalStatus,
        isEffectiveFinal: gates.manualFinalConfirmationEnabled ? null : outcome.isEffectiveFinal,
        performanceEligible: false, decisionSource: 'human', decisionActorId: user.id,
        explanation: json({ manualReason: input.reason, resolvedFromDecisionId: previous.id }),
      } });
      await tx.video.update({ where: { id: videoId }, data: { status: gates.manualFinalConfirmationEnabled ? VideoStatus.pending_final_confirmation : FINAL_STATUS[outcome.finalStatus as keyof typeof FINAL_STATUS] } });
      if (!gates.manualFinalConfirmationEnabled) {
        await tx.v11WorkflowGateDecision.create({ data: {
          videoId, workflowRevisionId: previous.workflowRevisionId, stage: 'final_confirmation',
          decision: outcome.businessConclusion, decisionSource: 'system',
          reason: 'Administrator resolved the R rating and the automatic final gate is enabled.',
          performanceEligible: false,
        } });
      }
      await this.logs.create({ userId: user.id, videoId, targetType: 'v11_comprehensive_decision', targetId: decision.id, actionType: 'v11_comprehensive_rating_manually_resolved', result: 'success', comment: input.reason, beforeValue: json({ id: previous.id, requiresAdminReview: true }), afterValue: json({ rating, decisionRevision: decision.decisionRevision }) }, tx);
      return decision;
    });
  }

  async confirmComprehensive(videoId: string, body: unknown, user: AuthenticatedUser) {
    const input = parse(confirmComprehensiveSchema, body);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM videos WHERE id = ${videoId}::uuid FOR UPDATE`);
      const video = await tx.video.findUnique({ where: { id: videoId } });
      if (!video) throw new NotFoundException('Video not found.');
      const previous = await tx.v11ComprehensiveDecision.findFirst({
        where: { videoId, workflowRevision: { status: 'current' } },
        orderBy: [{ decisionRevision: 'desc' }, { decidedAt: 'desc' }, { id: 'desc' }],
      });
      if (!previous || previous.id !== input.decisionId) throw new ConflictException('The comprehensive decision is no longer current.');
      if (!previous.comprehensiveRating || previous.requiresAdminReview) throw new ConflictException('The comprehensive rating requires administrator resolution first.');
      if (previous.finalStatus || previous.businessConclusion || previous.isEffectiveFinal !== null) throw new ConflictException('The comprehensive decision is already final.');
      const policy = await readPolicy(tx, 'v11_workflow_gates');
      if (!policy.manualFinalConfirmationEnabled) throw new ConflictException('Manual final confirmation is disabled.');
      const [holds, appeals] = await Promise.all([
        tx.v11WorkflowHold.count({ where: { workflowRevisionId: previous.workflowRevisionId, status: 'active' } }),
        tx.v11Appeal.count({ where: { workflowRevisionId: previous.workflowRevisionId, status: 'active' } }),
      ]);
      if (holds || appeals) throw new ConflictException('Unresolved workflow safety gates block final confirmation.');
      const rating = previous.comprehensiveRating as V11ComprehensiveRating;
      if (!dataRatings.has(rating)) throw new ConflictException('Current comprehensive rating is invalid.');
      const outcome = businessOutcomeFor(rating);
      const performanceEligible = outcome.businessConclusion === 'effective' && input.performanceEligible;
      const decision = await tx.v11ComprehensiveDecision.create({ data: {
        videoId, workflowRevisionId: previous.workflowRevisionId, contentDecisionId: previous.contentDecisionId,
        dataDecisionId: previous.dataDecisionId, decisionRevision: previous.decisionRevision + 1,
        comprehensiveRating: rating, matrixVersion: previous.matrixVersion, requiresAdminReview: false,
        businessConclusion: outcome.businessConclusion, finalStatus: outcome.finalStatus,
        isEffectiveFinal: outcome.isEffectiveFinal, performanceEligible,
        decisionSource: 'human', decisionActorId: user.id,
        explanation: json({ confirmationReason: input.reason, confirmedFromDecisionId: previous.id }),
      } });
      await tx.video.update({ where: { id: videoId }, data: { status: FINAL_STATUS[outcome.finalStatus] } });
      await tx.v11WorkflowGateDecision.create({ data: {
        videoId, workflowRevisionId: previous.workflowRevisionId, stage: 'final_confirmation',
        decision: outcome.businessConclusion, decisionSource: 'human', actorId: user.id,
        reason: input.reason, performanceEligible,
      } });
      await this.logs.create({ userId: user.id, videoId, targetType: 'v11_comprehensive_decision', targetId: decision.id, actionType: 'v11_comprehensive_final_confirmed', result: 'success', comment: input.reason, beforeValue: json({ id: previous.id, finalStatus: null }), afterValue: json({ comprehensiveRating: rating, finalStatus: outcome.finalStatus, performanceEligible }) }, tx);
      return decision;
    });
  }

  async markCase(id: string, body: unknown, user: AuthenticatedUser) {
    const input = parse(markV11CaseSchema, body);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM v11_comprehensive_decisions WHERE id = ${id}::uuid FOR UPDATE`);
      const decision = await tx.v11ComprehensiveDecision.findUnique({
        where: { id },
        include: { workflowRevision: { select: { id: true, status: true } } },
      });
      if (!decision?.finalStatus || !decision.comprehensiveRating) throw new ConflictException('Only a finalized V1.1 decision can be marked as a case.');
      if (decision.workflowRevision.status !== 'current') throw new ConflictException('Only the current workflow decision can be marked as a case.');
      const [holds, appeals] = await Promise.all([
        tx.v11WorkflowHold.count({ where: { workflowRevisionId: decision.workflowRevision.id, status: 'active' } }),
        tx.v11Appeal.count({ where: { workflowRevisionId: decision.workflowRevision.id, status: 'active' } }),
      ]);
      if (holds || appeals) throw new ConflictException('Unresolved workflow safety gates block case use.');
      const excellent = input.type === 'excellent' && ['S', 'A+', 'A'].includes(decision.comprehensiveRating) && decision.finalStatus === 'final_effective';
      const negative = input.type === 'negative' && decision.comprehensiveRating === 'D' && decision.finalStatus === 'final_invalid';
      if (!excellent && !negative) throw new ConflictException('The finalized decision does not meet the selected case rule.');
      const updated = await tx.v11ComprehensiveDecision.update({ where: { id }, data: { isExcellentCase: excellent, isNegativeCase: negative, caseMarkedById: user.id, caseMarkedAt: new Date(), caseNote: input.note } });
      await this.logs.create({ userId: user.id, videoId: decision.videoId, targetType: 'v11_comprehensive_decision', targetId: id, actionType: excellent ? 'v11_excellent_case_marked' : 'v11_negative_case_marked', result: 'success', afterValue: json({ type: input.type }) }, tx);
      return updated;
    });
  }

  async listCases(type: unknown, user: AuthenticatedUser) {
    if (type !== 'excellent' && type !== 'negative') throw new BadRequestException('Case type must be excellent or negative.');
    const visibility = this.permissions.buildVideoVisibilityWhere(user);
    const decisions = await this.db.v11ComprehensiveDecision.findMany({
      where: {
        ...(type === 'excellent' ? { isExcellentCase: true } : { isNegativeCase: true }),
        workflowRevision: {
          status: 'current',
          holds: { none: { status: 'active' } },
          appeals: { none: { status: 'active' } },
        },
        video: visibility,
      },
      orderBy: [{ caseMarkedAt: 'desc' }, { id: 'desc' }],
      take: 50,
      include: {
        video: { select: { id: true, title: true, brand: true, product: true, platform: true, videoType: true, creator: { select: { id: true, name: true } } } },
        caseMarkedBy: { select: { id: true, name: true } },
      },
    });
    return { items: decisions.map((decision) => ({
      evaluationId: decision.id,
      videoId: decision.video.id,
      title: decision.video.title,
      brand: decision.video.brand,
      product: decision.video.product,
      platform: decision.video.platform,
      videoType: decision.video.videoType,
      creator: decision.video.creator,
      comprehensiveRating: decision.comprehensiveRating,
      businessConclusion: decision.businessConclusion,
      decisionSource: decision.decisionSource,
      caseNote: decision.caseNote,
      caseMarkedAt: decision.caseMarkedAt?.toISOString() ?? null,
      caseMarkedBy: decision.caseMarkedBy,
    })) };
  }

  async latest(videoId: string, user: AuthenticatedUser) {
    const visible = await this.permissions.findVideoVisibleToUser(videoId, user);
    if (!visible) throw new NotFoundException('Video not found.');
    const workflow = await this.db.v11WorkflowRevision.findFirst({ where: { videoId, status: 'current' }, orderBy: { revision: 'desc' } });
    if (!workflow) return { content: null, data: null, comprehensive: null };
    const [content, data, comprehensive] = await Promise.all([
      workflow.activeContentDecisionId ? this.db.v11EvaluationDecision.findUnique({ where: { id: workflow.activeContentDecisionId }, select: { id: true, totalScore: true, contentRating: true, complianceStatus: true, inputComplete: true, stable: true, decidedAt: true } }) : null,
      this.db.v11DataRatingDecision.findFirst({ where: { workflowRevisionId: workflow.id }, orderBy: { decidedAt: 'desc' } }),
      this.db.v11ComprehensiveDecision.findFirst({ where: { workflowRevisionId: workflow.id }, orderBy: [{ decisionRevision: 'desc' }, { decidedAt: 'desc' }] }),
    ]);
    return { content, data, comprehensive };
  }
}
