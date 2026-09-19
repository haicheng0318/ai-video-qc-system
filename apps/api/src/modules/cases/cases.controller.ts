import { Body, Controller, Get, Param, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
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

  @Get('cases/export')
  async export(@Query() query: CaseListQueryDto, @CurrentUser() user: AuthenticatedUser, @Req() request: Request, @Res() response: Response) {
    const exported = await this.service.export(query, user, { ipAddress: request.ip, userAgent: request.headers['user-agent'] });
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    response.send(exported.content);
  }
}
