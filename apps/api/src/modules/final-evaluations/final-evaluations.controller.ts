import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FinalEvaluationHistoryQueryDto } from './dto/final-evaluation-history-query.dto';
import { TriggerFinalEvaluationDto } from './dto/trigger-final-evaluation.dto';
import { FinalEvaluationsService } from './final-evaluations.service';

@Controller('videos/:videoId')
@UseGuards(JwtAuthGuard)
export class FinalEvaluationsController {
  constructor(private readonly service: FinalEvaluationsService) {}

  @Post('final-evaluation')
  @HttpCode(HttpStatus.ACCEPTED)
  trigger(@Param('videoId') videoId: string, @Body() body: TriggerFinalEvaluationDto,
    @CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    return this.service.trigger(videoId, body, user, requestMeta(request));
  }

  @Get('final-evaluation/latest')
  latest(@Param('videoId') videoId: string, @CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    return this.service.latest(videoId, user, requestMeta(request));
  }

  @Get('final-evaluations/history')
  history(@Param('videoId') videoId: string, @Query() query: FinalEvaluationHistoryQueryDto,
    @CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    return this.service.history(videoId, query, user, requestMeta(request));
  }
}

function requestMeta(request: Request) {
  return { ipAddress: request.ip, userAgent: request.headers['user-agent'] };
}
