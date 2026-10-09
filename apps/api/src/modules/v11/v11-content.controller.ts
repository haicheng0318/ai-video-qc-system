import { ConflictException, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { V11ContentService } from './v11-content.service';

@Controller('videos/:videoId/v11-content-review')
@UseGuards(JwtAuthGuard)
export class V11ContentController {
  constructor(private readonly service: V11ContentService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  trigger(@Param('videoId') videoId: string, @CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    return this.service.trigger(videoId, user, { ipAddress: request.ip, userAgent: request.headers['user-agent'] });
  }

  @Get('latest')
  latest(@Param('videoId') videoId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.latest(videoId, user);
  }
}
