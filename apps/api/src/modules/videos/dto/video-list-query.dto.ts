import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { VideoStatus, VideoType } from '@prisma/client';

export class VideoListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

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
