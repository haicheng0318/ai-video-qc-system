import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateResultMetricSnapshotDto } from './dto/create-result-metric-snapshot.dto';
import { ResultMetricHistoryQueryDto } from './dto/result-metric-history-query.dto';
import { ResultMetricsService } from './result-metrics.service';

@Controller('videos/:videoId/result-metrics')
@UseGuards(JwtAuthGuard)
export class ResultMetricsController {
  constructor(private readonly resultMetricsService: ResultMetricsService) {}

  @Post()
  create(
    @Param('videoId') videoId: string,
    @Body() body: CreateResultMetricSnapshotDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.resultMetricsService.createSnapshot(videoId, body, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Get('latest')
  async latest(
    @Param('videoId') videoId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const result = await this.resultMetricsService.latest(videoId, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return response.status(200).json(result);
  }

  @Get('history')
  history(
    @Param('videoId') videoId: string,
    @Query() query: ResultMetricHistoryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.resultMetricsService.history(videoId, query, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
