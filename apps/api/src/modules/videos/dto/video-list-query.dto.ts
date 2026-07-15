import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { VideoStatus, VideoType } from '@prisma/client';

export class VideoListQueryDto {
  @IsOptional()
  @IsEnum(VideoStatus)
  status?: VideoStatus;

  @IsOptional()
  @IsEnum(VideoType)
  videoType?: VideoType;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  product?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  platform?: string;

  @IsOptional()
  @IsUUID()
  creatorId?: string;
}
