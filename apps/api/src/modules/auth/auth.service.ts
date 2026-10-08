import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { publicUser, validatePassword } from './auth-security';
import { parseJwtExpiresIn } from '../../env';
import { AuthenticatedUser } from '../../types/authenticated-user';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwtService: JwtService) {}
  async login(dto: LoginDto, meta: { ipAddress?: string; userAgent?: string }) {
    if (Buffer.byteLength(dto.password, 'utf8') > 72) throw new UnauthorizedException('Invalid account or password.');
    const user = await this.prisma.user.findUnique({ where: { account: dto.account } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash)) || (dto.adminOnly && user.role !== 'admin')) {
      await this.prisma.operationLog.create({ data: { actionType: 'login_failed', result: 'failure', ipAddress: meta.ipAddress } });
      throw new UnauthorizedException('Invalid account or password.');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`);
        const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
        this.assertActive(current);
        if (current.passwordHash !== user.passwordHash || (dto.adminOnly && current.role !== 'admin')) throw new UnauthorizedException('Invalid account or password.');
        await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        await tx.operationLog.create({ data: { userId: user.id, actionType: 'login_success', result: 'success' } });
        return this.issue(tx, current, meta);
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        await this.prisma.operationLog.create({ data: { userId: user.id, actionType: 'login_failed', result: 'failure', ipAddress: meta.ipAddress } });
      }
      throw error;
    }
  }
  private assertActive(user: User) {
    if (user.status !== 'active' || (user.expiresAt && user.expiresAt.getTime() <= Date.now())) throw new UnauthorizedException('Account is unavailable.');
  }
  private async issue(tx: Prisma.TransactionClient, user: User, meta: { ipAddress?: string; userAgent?: string } = {}) {
    const expiresAt = new Date(Math.min(Date.now() + parseJwtExpiresIn(process.env.JWT_EXPIRES_IN || '2h') * 1000, user.expiresAt?.getTime() || Infinity));
    const session = await tx.userSession.create({ data: { userId: user.id, expiresAt, ipAddress: meta.ipAddress, userAgent: meta.userAgent?.slice(0, 500) } });
    return { user: publicUser(user), token: await this.jwtService.signAsync({ sub: user.id, sid: session.id }), expiresAt };
  }
  async changePassword(identity: AuthenticatedUser, currentPassword: string, newPassword: string) {
    validatePassword(newPassword);
    if (Buffer.byteLength(currentPassword, 'utf8') > 72) throw new UnauthorizedException('Current password is incorrect.');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${identity.id}::uuid FOR UPDATE`);
      const user = await tx.user.findUniqueOrThrow({ where: { id: identity.id } }); this.assertActive(user);
      const session = identity.sessionId ? await tx.userSession.findUnique({ where: { id: identity.sessionId } }) : null;
      if (!session || session.userId !== user.id || session.revokedAt || session.expiresAt <= new Date()) throw new UnauthorizedException('Invalid session.');
      if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw new UnauthorizedException('Current password is incorrect.');
      const updated = await tx.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 12), mustChangePassword: false } });
      await tx.userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.operationLog.create({ data: { userId: user.id, actionType: 'password_changed', result: 'success' } });
      return this.issue(tx, updated);
    });
  }
  async logout(identity: AuthenticatedUser, all = false) {
    if (!identity.sessionId && !all) throw new UnauthorizedException('Invalid session.');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${identity.id}::uuid FOR UPDATE`);
      await tx.userSession.updateMany({ where: { userId: identity.id, ...(all ? {} : { id: identity.sessionId }), revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.operationLog.create({ data: { userId: identity.id, actionType: all ? 'logout_all' : 'logout', result: 'success' } });
    });
    return { success: true };
  }
}
