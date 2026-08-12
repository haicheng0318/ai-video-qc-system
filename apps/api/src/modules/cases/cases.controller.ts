import { Body, Controller, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CasesService } from './cases.service';
import { CaseListQueryDto } from './dto/case-list-query.dto';
import { MarkCaseDto } from './dto/mark-case.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class CasesController {
  constructor(private readonly service: CasesService) {}

  @Put('videos/:videoId/case-marking')
  mark(@Param('videoId') videoId: string, @Body() body: MarkCaseDto,
    @CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    return this.service.mark(videoId, body, user, {
      ipAddress: request.ip, userAgent: request.headers['user-agent'],
    });
  }

  @Get('cases')
  list(@Query() query: CaseListQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.list(query, user);
  }
}
