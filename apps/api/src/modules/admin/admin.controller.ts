import { Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Injectable, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { QuotasService } from '../quotas/quotas.service';
import { AdjustQuotaDto, BatchUsersDto, CreateUserDto, ReasonDto, UpdateUserDto, UsersQueryDto } from './admin.dto';
import { AdminUsersService } from './admin-users.service';
@Injectable()
export class AdminGuard implements CanActivate { canActivate(ctx: ExecutionContext) { if (ctx.switchToHttp().getRequest().user?.role !== 'admin') throw new ForbiddenException('Administrator required.'); return true; } }
@Controller('admin') @UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly users: AdminUsersService, private readonly quotas: QuotasService) {}
  @Get('users') list(@Query() query: UsersQueryDto) { return this.users.list(query); }
  @Post('users') create(@Body() input: CreateUserDto, @CurrentUser() actor: AuthenticatedUser) { return this.users.create(input, actor); }
  @Post('users/batch') batch(@Body() input: BatchUsersDto, @CurrentUser() actor: AuthenticatedUser) { return this.users.batch(input.users, actor); }
  @Get('users/:id') get(@Param('id', ParseUUIDPipe) id: string) { return this.users.get(id); }
  @Patch('users/:id') update(@Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateUserDto, @CurrentUser() actor: AuthenticatedUser) { return this.users.update(id, input, actor); }
  @Post('users/:id/archive') archive(@Param('id', ParseUUIDPipe) id: string, @Body() input: ReasonDto, @CurrentUser() actor: AuthenticatedUser) { return this.users.update(id, { status: 'archived', reason: input.reason }, actor); }
  @Post('users/:id/reset-password') reset(@Param('id', ParseUUIDPipe) id: string, @Body() input: ReasonDto, @CurrentUser() actor: AuthenticatedUser) { return this.users.resetPassword(id, input.reason, actor); }
  @Get('users/:id/sessions') sessions(@Param('id', ParseUUIDPipe) id: string) { return this.users.sessions(id); }
  @Post('users/:id/revoke-sessions') revoke(@Param('id', ParseUUIDPipe) id: string, @Body() input: ReasonDto, @CurrentUser() actor: AuthenticatedUser) { return this.users.revoke(id, input.reason, actor); }
  @Post('users/:id/sessions/:sessionId/revoke') revokeOne(@Param('id', ParseUUIDPipe) id: string, @Param('sessionId', ParseUUIDPipe) sid: string, @Body() input: ReasonDto, @CurrentUser() actor: AuthenticatedUser) { return this.users.revoke(id, input.reason, actor, sid); }
  @Get('users/:id/quotas') quotaSummary(@Param('id', ParseUUIDPipe) id: string) { return this.quotas.summary(id); }
  @Post('users/:id/quotas/adjust') adjust(@Param('id', ParseUUIDPipe) id: string, @Body() input: AdjustQuotaDto, @CurrentUser() actor: AuthenticatedUser) { return this.users.adjustQuota(id, input, actor); }
  @Get('roles') roles() { return { items: Object.values(UserRole).map((role) => ({ role, capabilities: {
    ownVideo: true, contentReview: ['admin', 'content_owner', 'director', 'visitor'].includes(role),
    teamVideo: role === 'supervisor', allVideos: ['admin', 'content_owner', 'operator', 'advertiser'].includes(role),
    supervisorReview: ['admin', 'content_owner', 'supervisor'].includes(role), resultData: ['admin', 'content_owner', 'operator', 'advertiser'].includes(role),
    finalConfirmation: ['admin', 'content_owner'].includes(role), caseManagement: ['admin', 'content_owner'].includes(role), admin: role === 'admin',
    dashboard: role !== 'visitor', caseRead: role !== 'visitor',
  } })) }; }
}
