import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { ThrottlerGuard } from '@nestjs/throttler';
import { IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { QuotasService } from '../quotas/quotas.service';
import { PrismaService } from '../prisma/prisma.service';
import { readPolicy } from '../admin/runtime-policy';

class ChangePasswordDto {
  @IsString() @MaxLength(128) currentPassword: string;
  @IsString() @MaxLength(128) newPassword: string;
}
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly quotas: QuotasService, private readonly db: PrismaService) {}
  private cookie(response: Response, result: { token: string; expiresAt: Date }) {
    response.cookie('qc_session', result.token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', expires: result.expiresAt });
  }
  @Post('login') @UseGuards(ThrottlerGuard)
  async login(@Body() dto: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(dto, { ipAddress: request.ip, userAgent: request.headers['user-agent'] });
    this.cookie(response, result); return { user: result.user };
  }
  @Get('me') me(@CurrentUser() user: AuthenticatedUser) { const { sessionId, ...safe } = user; return { user: safe }; }
  @Get('quotas') summary(@CurrentUser() user: AuthenticatedUser) { return this.quotas.summary(user.id); }
  @Get('business-options') async options() { return { ...await readPolicy(this.db, 'video_options'), site: await readPolicy(this.db, 'site') }; }
  @Post('change-password')
  async change(@Body() dto: ChangePasswordDto, @CurrentUser() user: AuthenticatedUser, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.changePassword(user, dto.currentPassword, dto.newPassword); this.cookie(response, result); return { user: result.user };
  }
  @Post('logout') async logout(@CurrentUser() user: AuthenticatedUser, @Res({ passthrough: true }) response: Response) { response.clearCookie('qc_session', { path: '/' }); return this.auth.logout(user); }
  @Post('logout-all') async logoutAll(@CurrentUser() user: AuthenticatedUser, @Res({ passthrough: true }) response: Response) { response.clearCookie('qc_session', { path: '/' }); return this.auth.logout(user, true); }
}
