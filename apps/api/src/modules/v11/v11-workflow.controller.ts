import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateV11AppealDto } from './dto/create-v11-appeal.dto';
import { V11WorkflowService } from './v11-workflow.service';
import { RolesGuard } from '../permissions/roles.guard';
import { Roles } from '../permissions/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('videos/:videoId/v11-workflow')
@UseGuards(JwtAuthGuard)
export class V11WorkflowController {
  constructor(private readonly service: V11WorkflowService) {}

  @Post('appeals')
  @HttpCode(HttpStatus.ACCEPTED)
  appeal(@Param('videoId') videoId: string, @Body() dto: CreateV11AppealDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.appeal(videoId, dto, user);
  }

  @Get()
  get(@Param('videoId') videoId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.get(videoId, user);
  }

  @Post('holds')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  hold(@Param('videoId') videoId: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.service.hold(videoId, body, user);
  }

  @Post('resume')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  resume(@Param('videoId') videoId: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.service.resume(videoId, body, user);
  }

  @Post('appeals/:appealId/resolve')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  resolveAppeal(@Param('videoId') videoId: string, @Param('appealId') appealId: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.service.resolveAppeal(videoId, appealId, body, user);
  }
}
