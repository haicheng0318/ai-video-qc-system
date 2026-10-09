import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../permissions/roles.decorator';
import { RolesGuard } from '../permissions/roles.guard';
import { V11RatingsService } from './v11-ratings.service';

@Controller('v11')
@UseGuards(JwtAuthGuard)
export class V11RatingsController {
  constructor(private readonly service: V11RatingsService) {}

  @Post('benchmark-profiles')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  createProfile(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) { return this.service.createProfile(body, user); }

  @Get('benchmark-profiles')
  listProfiles() { return this.service.listProfiles(); }

  @Post('benchmark-profiles/:id/approve')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  approveProfile(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) { return this.service.approveProfile(id, body, user); }

  @Post('videos/:videoId/data-rating')
  rateData(@Param('videoId') videoId: string, @CurrentUser() user: AuthenticatedUser) { return this.service.rateData(videoId, user); }

  @Post('videos/:videoId/comprehensive-rating')
  comprehensive(@Param('videoId') videoId: string, @CurrentUser() user: AuthenticatedUser) { return this.service.createComprehensiveDecision(videoId, user); }

  @Post('videos/:videoId/comprehensive-rating/manual')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  resolve(@Param('videoId') videoId: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) { return this.service.resolveManualComprehensive(videoId, body, user); }

  @Post('videos/:videoId/comprehensive-rating/confirm')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  confirm(@Param('videoId') videoId: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) { return this.service.confirmComprehensive(videoId, body, user); }

  @Get('videos/:videoId/ratings/latest')
  latest(@Param('videoId') videoId: string, @CurrentUser() user: AuthenticatedUser) { return this.service.latest(videoId, user); }

  @Post('comprehensive-ratings/:id/case')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  markCase(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) { return this.service.markCase(id, body, user); }

  @Get('cases')
  listCases(@Query('type') type: string, @CurrentUser() user: AuthenticatedUser) { return this.service.listCases(type, user); }
}
