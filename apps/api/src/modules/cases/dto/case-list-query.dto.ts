import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { videoTypes } from '@ai-video-qc/shared';

export class CaseListQueryDto {
  @IsIn(['excellent', 'negative'])
  type!: 'excellent' | 'negative';

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() platform?: string;
  @IsOptional() @IsIn(videoTypes) videoType?: string;
  @IsOptional() @IsUUID() creatorId?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
}
