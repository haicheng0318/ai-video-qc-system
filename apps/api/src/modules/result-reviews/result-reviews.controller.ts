import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ResultReviewHistoryQueryDto } from './dto/result-review-history-query.dto';
import { TriggerResultReviewDto } from './dto/trigger-result-review.dto';
import { ResultReviewsService } from './result-reviews.service';

@Controller('videos/:videoId')
@UseGuards(JwtAuthGuard)
export class ResultReviewsController {
  constructor(private readonly resultReviewsService: ResultReviewsService) {}

  @Post('result-review')
  @HttpCode(HttpStatus.ACCEPTED)
  trigger(
    @Param('videoId') videoId: string,
    @Body() body: TriggerResultReviewDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.resultReviewsService.trigger(videoId, body, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Get('result-review/latest')
  latest(
    @Param('videoId') videoId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.resultReviewsService.latest(videoId, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Get('result-reviews/history')
  history(
    @Param('videoId') videoId: string,
    @Query() query: ResultReviewHistoryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.resultReviewsService.history(videoId, query, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
