import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateSupervisorReviewDto } from './dto/create-supervisor-review.dto';
import { SupervisorReviewsService } from './supervisor-reviews.service';

@Controller('videos')
@UseGuards(JwtAuthGuard)
export class SupervisorReviewsController {
  constructor(private readonly supervisorReviewsService: SupervisorReviewsService) {}

  @Post(':id/supervisor-review')
  create(
    @Param('id') id: string,
    @Body() body: CreateSupervisorReviewDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.supervisorReviewsService.create(id, body, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Get(':id/supervisor-review/latest')
  latest(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.supervisorReviewsService.latest(id, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
