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
} from '@nestjs/common';
import { Request, Response } from 'express';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateVideoDto } from './dto/create-video.dto';
import { VideoListQueryDto } from './dto/video-list-query.dto';
import { VideosService } from './videos.service';
import { GeminiService } from '../ai/gemini/gemini.service';
import { CreateVideoRevisionDto } from './dto/create-video-revision.dto';
import { videoUploadInterceptor } from './video-upload.config';

@Controller('videos')
@UseGuards(JwtAuthGuard)
export class VideosController {
  constructor(
    private readonly videosService: VideosService,
    private readonly geminiService: GeminiService,
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
    return this.geminiService.triggerContentReview(id, user, {
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
    return this.geminiService.latest(id, user, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });
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
}
