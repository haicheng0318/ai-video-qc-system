import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ExecuteRuleEngineDto } from './dto/execute-rule-engine.dto';
import { RuleEngineHistoryQueryDto } from './dto/rule-engine-history-query.dto';
import { RuleEngineService } from './rule-engine.service';

@Controller('videos/:videoId/rule-engine')
@UseGuards(JwtAuthGuard)
export class RuleEngineController {
  constructor(private readonly ruleEngineService: RuleEngineService) {}

  @Post()
  execute(
    @Param('videoId') videoId: string,
    @Body() body: ExecuteRuleEngineDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.ruleEngineService.execute(videoId, body, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Get('latest')
  latest(
    @Param('videoId') videoId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.ruleEngineService.latest(videoId, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Get('history')
  history(
    @Param('videoId') videoId: string,
    @Query() query: RuleEngineHistoryQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.ruleEngineService.history(videoId, query, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
