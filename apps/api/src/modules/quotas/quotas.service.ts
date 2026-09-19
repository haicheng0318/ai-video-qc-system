import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const quotaKinds = ['upload_count', 'storage_bytes', 'content_evaluations'] as const;
export type QuotaKind = typeof quotaKinds[number];
export type QuotaPeriod = 'daily' | 'monthly' | 'lifetime';
export type QuotaAdjustmentInput = { kind: QuotaKind; period: QuotaPeriod; limit: number | null; reason: string; businessKey: string };
export function quotaWindow(period: QuotaPeriod, now = new Date()): { start: Date; end: Date | null } {
  if (period === 'lifetime') return { start: new Date(0), end: null };
  const shifted = new Date(now.getTime() + 8 * 3600000);
  const y = shifted.getUTCFullYear(), m = shifted.getUTCMonth(), d = shifted.getUTCDate();
  return period === 'daily'
    ? { start: new Date(Date.UTC(y, m, d) - 8 * 3600000), end: new Date(Date.UTC(y, m, d + 1) - 8 * 3600000) }
    : { start: new Date(Date.UTC(y, m, 1) - 8 * 3600000), end: new Date(Date.UTC(y, m + 1, 1) - 8 * 3600000) };
}
export function assertIdentityActive(user: { status: string; expiresAt?: Date | null } | null) {
  if (!user || user.status !== 'active' || (user.expiresAt && user.expiresAt.getTime() <= Date.now())) throw new ForbiddenException('Account is disabled, archived or expired.');
}

@Injectable()
export class QuotasService {
  constructor(private readonly prisma: PrismaService) {}
  async lock(tx: Prisma.TransactionClient, userId: string) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`);
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Account not found.');
    return user;
  }
  async reserve(tx: Prisma.TransactionClient, userId: string, kind: QuotaKind, amount: number, businessKey: string) {
    this.validate(kind, amount, businessKey);
    const user = await this.lock(tx, userId); assertIdentityActive(user);
    const existing = await tx.quotaLedger.findUnique({ where: { userId_kind_businessKey: { userId, kind, businessKey } } });
    if (existing) {
      if (existing.amount !== BigInt(amount)) throw new ConflictException('Business key amount cannot change.');
      if (existing.state === 'released') throw new ConflictException('Business key was already released.');
      return existing;
    }
    const policy = await tx.quotaPolicy.findUnique({ where: { userId_kind: { userId, kind } } });
    if (user.role === 'visitor' && !policy) throw new ForbiddenException('Visitor quota is not configured.');
    const window = quotaWindow((policy?.period || 'lifetime') as QuotaPeriod);
    const total = await tx.quotaLedger.aggregate({ where: { userId, kind, windowStart: window.start, state: { in: ['reserved', 'committed'] } }, _sum: { amount: true } });
    if (policy?.limit !== null && policy?.limit !== undefined && (total._sum.amount || 0n) + BigInt(amount) > policy.limit) throw new ForbiddenException('Quota exceeded.');
    return tx.quotaLedger.create({ data: { userId, kind, amount: BigInt(amount), businessKey, windowStart: window.start, windowEnd: window.end } });
  }
  async commit(tx: Prisma.TransactionClient, userId: string, kind: QuotaKind, businessKey: string) { return this.settle(tx, userId, kind, businessKey, 'committed'); }
  async release(tx: Prisma.TransactionClient, userId: string, kind: QuotaKind, businessKey: string) { return this.settle(tx, userId, kind, businessKey, 'released'); }
  private async settle(tx: Prisma.TransactionClient, userId: string, kind: QuotaKind, businessKey: string, state: string) {
    await this.lock(tx, userId);
    const entry = await tx.quotaLedger.findUnique({ where: { userId_kind_businessKey: { userId, kind, businessKey } } });
    // Legacy jobs deliberately have no reservation and are never charged retroactively.
    if (!entry) return null;
    if (entry.state === state) return entry;
    if (entry.state !== 'reserved') throw new ConflictException('Quota has already been settled.');
    return tx.quotaLedger.update({ where: { id: entry.id }, data: { state } });
  }
  async adjust(tx: Prisma.TransactionClient, userId: string, input: QuotaAdjustmentInput, actorId: string) {
    if (input.limit === undefined) throw new BadRequestException('Explicit quota limit or null required.');
    this.validate(input.kind, input.limit ?? 0, input.businessKey, true);
    if (!['daily', 'monthly', 'lifetime'].includes(input.period) || !input.reason?.trim()) throw new BadRequestException('Valid period and reason required.');
    if (input.kind === 'storage_bytes' && input.period !== 'lifetime') throw new BadRequestException('Storage capacity requires a lifetime period.');
    await this.lock(tx, userId);
    const data = { kind: input.kind, period: input.period, limit: input.limit, reason: input.reason.trim() };
    const previous = await tx.quotaAdjustment.findUnique({ where: { userId_businessKey: { userId, businessKey: input.businessKey } } });
    if (previous) {
      const p = previous.data as typeof data;
      if (p.kind !== data.kind || p.period !== data.period || p.limit !== data.limit || p.reason !== data.reason) throw new ConflictException('Business key adjustment cannot change.');
      return { adjusted: true };
    }
    const existing = await tx.quotaPolicy.findUnique({ where: { userId_kind: { userId, kind: input.kind } } });
    if (existing && existing.period !== input.period && await tx.quotaLedger.count({ where: { userId, kind: input.kind } })) throw new ConflictException('Cannot change quota period after usage.');
    await tx.quotaPolicy.upsert({ where: { userId_kind: { userId, kind: input.kind } }, create: { userId, kind: input.kind, period: input.period, limit: input.limit }, update: { period: input.period, limit: input.limit } });
    await tx.quotaAdjustment.create({ data: { userId, businessKey: input.businessKey, data } });
    await tx.operationLog.create({ data: { userId: actorId, targetType: 'user', targetId: userId, actionType: 'quota_adjusted', result: 'success', comment: input.reason, afterValue: data } });
    return { adjusted: true };
  }
  async summary(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const user = await this.lock(tx, userId);
      const policies = await tx.quotaPolicy.findMany({ where: { userId } });
      const quotas: Array<{ kind: QuotaKind; period: QuotaPeriod; limit: number | null; used: number; reserved: number; remaining: number | null; windowStart: Date; windowEnd: Date | null }> = [];
      for (const kind of quotaKinds) {
        const policy = policies.find((p) => p.kind === kind);
        const period = (policy?.period || 'lifetime') as QuotaPeriod, window = quotaWindow(period);
        const totals = await tx.quotaLedger.groupBy({ by: ['state'], where: { userId, kind, windowStart: window.start }, _sum: { amount: true } });
        const used = Number(totals.find((t) => t.state === 'committed')?._sum.amount || 0);
        const reserved = Number(totals.find((t) => t.state === 'reserved')?._sum.amount || 0);
        const limit = policy?.limit === undefined || policy.limit === null ? null : Number(policy.limit);
        quotas.push({ kind, period, limit, used, reserved, remaining: limit === null ? null : Math.max(0, limit - used - reserved), windowStart: window.start, windowEnd: window.end });
      }
      return { expiresAt: user.expiresAt, quotas };
    });
  }
  private validate(kind: string, amount: number, key: string, allowZero = false) {
    if (!quotaKinds.includes(kind as QuotaKind) || !Number.isSafeInteger(amount) || amount < (allowZero ? 0 : 1) || !key || key.length > 200) throw new BadRequestException('Invalid quota amount or business key.');
  }
}
