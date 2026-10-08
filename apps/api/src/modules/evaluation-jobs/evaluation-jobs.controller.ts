import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EvaluationJobsService } from './evaluation-jobs.service';

@Controller('evaluation-jobs')
@UseGuards(JwtAuthGuard)
export class EvaluationJobsController {
  constructor(private readonly jobs: EvaluationJobsService) {}
  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.jobs.get(id, user, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }
}
