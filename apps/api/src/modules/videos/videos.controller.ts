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
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { diskStorage } from 'multer';
import { extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateVideoDto } from './dto/create-video.dto';
import { VideoListQueryDto } from './dto/video-list-query.dto';
import { VideosService } from './videos.service';

const allowedMimeTypes = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

function getStorageDir() {
  return resolve(process.cwd(), '../../', process.env.VIDEO_STORAGE_DIR || './storage/videos');
}

function getMaxVideoSizeBytes() {
  const maxMb = Number(process.env.MAX_VIDEO_SIZE_MB || 500);
  return maxMb * 1024 * 1024;
}

const uploadInterceptor = FileInterceptor('file', {
  storage: diskStorage({
    destination: (_req, _file, callback) => {
      const storageDir = getStorageDir();
      if (!existsSync(storageDir)) {
        mkdirSync(storageDir, { recursive: true });
      }
      callback(null, storageDir);
    },
    filename: (_req, file, callback) => {
      callback(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`);
    },
  }),
  limits: {
    fileSize: getMaxVideoSizeBytes(),
  },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new BadRequestException('Only MP4, MOV, and WEBM videos are supported.'), false);
      return;
    }
    callback(null, true);
  },
});

@Controller('videos')
@UseGuards(JwtAuthGuard)
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @UseInterceptors(uploadInterceptor)
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

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: VideoListQueryDto) {
    return this.videosService.list(user, query);
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
