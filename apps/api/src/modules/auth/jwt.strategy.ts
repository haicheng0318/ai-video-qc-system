import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { getJwtConfig } from '../../env';
import { PrismaService } from '../prisma/prisma.service';
import { publicUser, sessionCookie } from './auth-security';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: sessionCookie,
      ignoreExpiration: false,
      secretOrKey: getJwtConfig().jwtSecret,
    });
  }

  async validate(payload: { sub: string; sid?: string }) {
    const uuid = /^[0-9a-f-]{36}$/i;
    if (!payload.sid || !uuid.test(payload.sid) || !uuid.test(payload.sub)) throw new UnauthorizedException('Invalid session.');
    const session = await this.prisma.userSession.findUnique({ where: { id: payload.sid }, include: { user: true } });
    const user = session?.user;
    if (!session || !user || user.id !== payload.sub || session.revokedAt || session.expiresAt.getTime() <= Date.now() || user.status !== 'active' || (user.expiresAt && user.expiresAt.getTime() <= Date.now())) {
      throw new UnauthorizedException('User is disabled or does not exist.');
    }

    return { ...publicUser(user), sessionId: session.id };
  }
}
