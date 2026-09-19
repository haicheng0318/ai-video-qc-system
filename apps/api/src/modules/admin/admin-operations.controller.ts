import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from './admin.controller';
import { AdminOperationsService } from './admin-operations.service';
import { ControlledActionDto, OperationsQueryDto, SaveSettingDto } from './admin-operations.dto';

@Controller('admin/operations') @UseGuards(JwtAuthGuard, AdminGuard)
export class AdminOperationsController {
  constructor(private readonly service: AdminOperationsService) {}
  @Get('overview') overview(@Query() q: OperationsQueryDto) { return this.service.overview(q); }
  @Get('job-statistics') statistics(@Query() q: OperationsQueryDto) { return this.service.jobStatistics(q); }
  @Get('jobs') jobs(@Query() q: OperationsQueryDto) { return this.service.listJobs(q); }
  @Get('jobs/:id') job(@Param('id', ParseUUIDPipe) id: string) { return this.service.job(id); }
  @Post('jobs/:id/retry') retry(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ControlledActionDto, @CurrentUser() user: AuthenticatedUser) { return this.service.retry(id, dto, user); }
  @Get('ai') ai() { return this.service.ai(); }
  @Get('storage') storage() { return this.service.storage(); }
  @Get('usage') usage(@Query() q: OperationsQueryDto) { return this.service.usage(q); }
  @Get('usage-summary') summary(@Query() q: OperationsQueryDto) { return this.service.usageSummary(q); }
  @Post('usage/export') export(@Query() q: OperationsQueryDto, @Body() dto: ControlledActionDto, @CurrentUser() user: AuthenticatedUser) { return this.service.exportUsage(q, dto, user); }
  @Get('settings') settings() { return this.service.settings(); }
  @Put('settings/:key') save(@Param('key') key: string, @Body() dto: SaveSettingDto, @CurrentUser() user: AuthenticatedUser) { return this.service.saveSetting(key, dto, user); }
  @Get('configuration-revisions') revisions(@Query() q: OperationsQueryDto) { return this.service.revisions(q); }
  @Get('logs') logs(@Query() q: OperationsQueryDto) { return this.service.logs(q); }
  @Post('logs/export') exportLogs(@Query() q: OperationsQueryDto, @Body() dto: ControlledActionDto, @CurrentUser() user: AuthenticatedUser) { return this.service.exportLogs(q, dto, user); }
  @Post('security/export') exportSecurity(@Query() q: OperationsQueryDto, @Body() dto: ControlledActionDto, @CurrentUser() user: AuthenticatedUser) { return this.service.exportLogs(q, dto, user, true); }
  @Get('security') security(@Query() q: OperationsQueryDto) { return this.service.logs(q, true); }
  @Get('sessions') sessions(@Query() q: OperationsQueryDto) { return this.service.sessions(q); }
  @Get('dependencies') dependencies() { return this.service.dependencies(); }
}
