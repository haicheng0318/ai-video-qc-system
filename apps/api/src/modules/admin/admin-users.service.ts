import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { QuotasService, assertIdentityActive, quotaKinds } from '../quotas/quotas.service';
import { publicUser, validatePassword } from '../auth/auth-security';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { AdjustQuotaDto, CreateUserDto, UpdateUserDto, UsersQueryDto } from './admin.dto';

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService, private readonly quotas: QuotasService) {}
  private safe(user: User) { return { ...publicUser(user), status: user.status, createdById: user.createdById, lastLoginAt: user.lastLoginAt, createdAt: user.createdAt }; }
  async list(query: UsersQueryDto) {
    const where: Prisma.UserWhereInput = { role: query.role, status: query.status, ...(query.search ? { OR: [{ account: { contains: query.search, mode: 'insensitive' } }, { name: { contains: query.search, mode: 'insensitive' } }] } : {}) };
    const [items, total] = await this.prisma.$transaction([this.prisma.user.findMany({ where, take: query.pageSize, skip: (query.page - 1) * query.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }), this.prisma.user.count({ where })]);
    return { items: items.map((u) => this.safe(u)), total, page: query.page, pageSize: query.pageSize };
  }
  async get(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Account not found.');
    return { user: this.safe(user) };
  }
  private async actor(tx: Prisma.TransactionClient, actor: AuthenticatedUser) {
    const current = await tx.user.findUnique({ where: { id: actor.id } }); assertIdentityActive(current);
    if (current?.role !== 'admin') throw new ForbiddenException('Administrator required.');
  }
  private reason(reason: string) { if (!reason?.trim()) throw new BadRequestException('Reason required.'); }
  private async manager(tx: Prisma.TransactionClient, id: string | null | undefined, target?: string) {
    if (!id) return;
    const manager = await tx.user.findUnique({ where: { id } });
    if (id === target || !manager || manager.status !== 'active' || (manager.expiresAt && manager.expiresAt <= new Date()) || !['admin', 'content_owner', 'supervisor'].includes(manager.role)) throw new BadRequestException('Manager must be an active manager account.');
  }
  private async audit(tx: Prisma.TransactionClient, actorId: string, targetId: string, actionType: string, reason: string, afterValue?: Prisma.InputJsonValue) {
    await tx.operationLog.create({ data: { userId: actorId, targetType: 'user', targetId, actionType, result: 'success', comment: reason.trim(), afterValue } });
  }
  private async transaction<T>(action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try { return await this.prisma.$transaction(async (tx) => { await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(701090702)`); return action(tx); }, { timeout: 30000 }); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Account or business key already exists.'); throw error; }
  }
  async create(input: CreateUserDto, actor: AuthenticatedUser) { const result = await this.batch([input], actor); return result.items[0]; }
  async batch(inputs: CreateUserDto[], actor: AuthenticatedUser) {
    if (!inputs.length || inputs.length > 20) throw new BadRequestException('Batch must contain 1–20 accounts.');
    // Hash outside transaction so bounded bulk creates do not hold the administration lock for bcrypt work.
    const prepared = await Promise.all(inputs.map(async (input) => {
      this.reason(input.reason); const password = input.initialPassword || randomBytes(18).toString('base64url'); validatePassword(password);
      return { input, password, passwordHash: await bcrypt.hash(password, 12) };
    }));
    return this.transaction(async (tx) => {
      await this.actor(tx, actor); const items: Array<{ user: ReturnType<AdminUsersService['safe']>; initialPassword: string }> = [];
      for (const { input, password, passwordHash } of prepared) {
        const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
        if (expiresAt && expiresAt <= new Date()) throw new BadRequestException('Expiry must be in the future.');
        if (input.role === 'visitor' && (!expiresAt || !input.quotas || quotaKinds.some((kind) => !input.quotas!.some((q) => q.kind === kind && q.limit !== null && q.limit !== undefined)))) throw new BadRequestException('Visitor requires future expiry and all three explicit finite quotas.');
        if (new Set(input.quotas?.map((q) => q.kind)).size !== (input.quotas?.length || 0)) throw new BadRequestException('Duplicate quota kind.');
        await this.manager(tx, input.managerId);
        const user = await tx.user.create({ data: { account: input.account, name: input.name, role: input.role, department: input.department, managerId: input.managerId, expiresAt, passwordHash, mustChangePassword: true, createdById: actor.id } });
        for (const quota of input.quotas || []) await this.quotas.adjust(tx, user.id, { ...quota, limit: quota.limit ?? null, reason: input.reason, businessKey: `create:${randomUUID()}` }, actor.id);
        await this.audit(tx, actor.id, user.id, 'account_created', input.reason, { account: user.account, role: user.role });
        items.push({ user: this.safe(user), initialPassword: password });
      }
      return { items };
    });
  }
  async update(id: string, input: UpdateUserDto, actor: AuthenticatedUser) {
    this.reason(input.reason);
    return this.transaction(async (tx) => {
      await this.actor(tx, actor); const before = await this.quotas.lock(tx, id);
      if (before.status === 'archived' && input.status && input.status !== 'archived') throw new ConflictException('Archived accounts cannot be restored.');
      const next = { ...before, ...input, expiresAt: input.expiresAt === undefined ? before.expiresAt : input.expiresAt ? new Date(input.expiresAt) : null };
      const active = (u: typeof next | User) => u.role === 'admin' && u.status === 'active' && (!u.expiresAt || u.expiresAt > new Date());
      if (active(before) && (!active(next) || (next.expiresAt && (!before.expiresAt || next.expiresAt < before.expiresAt)))) {
        const others = await tx.user.count({ where: { id: { not: id }, role: 'admin', status: 'active', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
        if (!others) throw new ConflictException('The last active administrator must remain active and non-expired.');
      }
      if (next.role === 'visitor') {
        const policies = await tx.quotaPolicy.findMany({ where: { userId: id } });
        if (!next.expiresAt || quotaKinds.some((k) => !policies.some((p) => p.kind === k && p.limit !== null))) throw new BadRequestException('Visitor requires expiry and explicit quotas.');
      }
      await this.manager(tx, input.managerId, id);
      const { reason, ...changes } = input;
      const updated = await tx.user.update({ where: { id }, data: { ...changes, expiresAt: next.expiresAt } });
      if (input.role !== undefined || input.status !== undefined || input.expiresAt !== undefined) await tx.userSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit(tx, actor.id, id, 'account_updated', reason, { role: updated.role, status: updated.status, expiresAt: updated.expiresAt?.toISOString() || null });
      return { user: this.safe(updated) };
    });
  }
  async resetPassword(id: string, reason: string, actor: AuthenticatedUser) {
    this.reason(reason); const password = randomBytes(18).toString('base64url'), hash = await bcrypt.hash(password, 12);
    return this.transaction(async (tx) => {
      await this.actor(tx, actor); await this.quotas.lock(tx, id);
      await tx.user.update({ where: { id }, data: { passwordHash: hash, mustChangePassword: true } });
      await tx.userSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit(tx, actor.id, id, 'password_reset', reason); return { initialPassword: password };
    });
  }
  async adjustQuota(id: string, input: AdjustQuotaDto, actor: AuthenticatedUser) {
    return this.transaction(async (tx) => { await this.actor(tx, actor); return this.quotas.adjust(tx, id, input, actor.id); });
  }
  async sessions(id: string) {
    if (!await this.prisma.user.findUnique({ where: { id } })) throw new NotFoundException('Account not found.');
    return { items: await this.prisma.userSession.findMany({ where: { userId: id }, take: 100, orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true, expiresAt: true, revokedAt: true, ipAddress: true, userAgent: true } }) };
  }
  async revoke(id: string, reason: string, actor: AuthenticatedUser, sessionId?: string) {
    this.reason(reason);
    return this.transaction(async (tx) => {
      await this.actor(tx, actor); await this.quotas.lock(tx, id);
      if (sessionId && !await tx.userSession.findFirst({ where: { id: sessionId, userId: id } })) throw new NotFoundException('Session not found for account.');
      await tx.userSession.updateMany({ where: { userId: id, ...(sessionId ? { id: sessionId } : {}), revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit(tx, actor.id, id, 'sessions_revoked', reason); return { success: true };
    });
  }
}
