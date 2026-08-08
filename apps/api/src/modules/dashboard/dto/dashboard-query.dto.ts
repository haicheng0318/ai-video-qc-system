import { IsDateString, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { videoTypes } from '@ai-video-qc/shared';

export class DashboardQueryDto {
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() platform?: string;
  @IsOptional() @IsIn(videoTypes) videoType?: string;
  @IsOptional() @IsUUID() creatorId?: string;
}

export class DashboardTrendQueryDto extends DashboardQueryDto {
  @IsOptional() @IsIn(['day', 'week']) granularity: 'day' | 'week' = 'day';
}

export class DashboardBreakdownQueryDto extends DashboardQueryDto {
  @IsIn(['brand', 'platform', 'videoType', 'creator'])
  groupBy!: 'brand' | 'platform' | 'videoType' | 'creator';
}
