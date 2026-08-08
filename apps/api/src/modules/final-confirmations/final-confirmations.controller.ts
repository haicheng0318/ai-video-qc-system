import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateFinalConfirmationDto } from './dto/create-final-confirmation.dto';
import { FinalConfirmationsService } from './final-confirmations.service';

@Controller('videos/:videoId/final-confirmation')
@UseGuards(JwtAuthGuard)
export class FinalConfirmationsController {
  constructor(private readonly service: FinalConfirmationsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  confirm(
    @Param('videoId') videoId: string,
    @Body() body: CreateFinalConfirmationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.service.confirm(videoId, body, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
