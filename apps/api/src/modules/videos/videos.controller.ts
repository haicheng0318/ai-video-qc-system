import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Body,
  HttpCode,
  HttpStatus,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateVideoDto } from './dto/create-video.dto';
import { VideoListQueryDto } from './dto/video-list-query.dto';
import { VideosService } from './videos.service';
import { ContentReviewService } from '../ai/gemini/gemini.service';
import { CreateVideoRevisionDto } from './dto/create-video-revision.dto';
import { videoUploadInterceptor } from './video-upload.config';
import { CreateDirectUploadTicketDto } from './dto/create-direct-upload-ticket.dto';
import { CreateDirectVideoDto } from './dto/create-direct-video.dto';
import { CreateDirectVideoRevisionDto } from './dto/create-direct-video-revision.dto';

@Controller('videos')
@UseGuards(JwtAuthGuard)
export class VideosController {
  constructor(
    private readonly videosService: VideosService,
    private readonly contentReviewService: ContentReviewService,
  ) {}

  @Post()
  @UseInterceptors(videoUploadInterceptor)
  create(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CreateVideoDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    if (!file) {
      throw new BadRequestException('Video file is required.');
    }
    return this.videosService.create(body, file, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      uploadKey: request.headers['idempotency-key'] as string,
    });
  }

  @Post('direct-upload-ticket')
  createDirectUploadTicket(
    @Body() body: CreateDirectUploadTicketDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const idempotencyKey = request.headers['idempotency-key'];
    return this.videosService.createDirectUploadTicket(body, user, typeof idempotencyKey === 'string' ? idempotencyKey : undefined);
  }

  @Post('direct-upload-tickets/:ticketId/cancel')
  cancelTicket(@Param('ticketId', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) { return this.videosService.cancelDirectUploadTicket(id, user); }

  @Post('direct')
  createDirect(
    @Body() body: CreateDirectVideoDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.videosService.createDirect(body, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Post(':id/revisions')
  @UseInterceptors(videoUploadInterceptor)
  createRevision(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CreateVideoRevisionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    if (!file) throw new BadRequestException('Video file is required.');
    return this.videosService.createRevision(id, body, file, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      uploadKey: request.headers['idempotency-key'] as string,
    });
  }

  @Post(':id/revisions/direct')
  createDirectRevision(
    @Param('id') id: string,
    @Body() body: CreateDirectVideoRevisionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.videosService.createDirectRevision(id, body, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: VideoListQueryDto) {
    return this.videosService.list(user, query);
  }

  @Post(':id/content-review')
  @HttpCode(HttpStatus.ACCEPTED)
  contentReview(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.contentReviewService.triggerContentReview(id, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Get(':id/content-review/latest')
  latestContentReview(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.contentReviewService.latest(id, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  @Get(':id/content-reviews/:reviewId')
  contentReviewStatus(
    @Param('id') id: string,
    @Param('reviewId') reviewId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    return this.contentReviewService.latest(id, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    }, reviewId);
  }

  @Get(':id')
  async detail(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() request: Request) {
    const video = await this.videosService.detail(id, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    if (!video) {
      throw new NotFoundException('Video not found.');
    }

    return video;
  }

  @Get(':id/report')
  async report(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() request: Request, @Res() response: Response) {
    const report = await this.videosService.exportReport(id, user, { ipAddress: request.ip, userAgent: request.headers['user-agent'] });
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
    response.send(report.content);
  }

  @Get(':id/file')
  async file(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const result = await this.videosService.prepareVideoFile(id, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    if (!result) {
      throw new NotFoundException('Video not found.');
    }

    return this.videosService.streamVideoFile(result.video, request, response);
  }

  @Get(':id/file-url')
  async fileUrl(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ) {
    const result = await this.videosService.prepareVideoFile(id, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    if (!result) {
      throw new NotFoundException('Video not found.');
    }

    return this.videosService.createVideoPlaybackUrl(result.video);
  }
}
