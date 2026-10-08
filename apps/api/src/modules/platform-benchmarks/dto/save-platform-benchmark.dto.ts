import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { VideoType } from '@prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const optionalTrim = ({ value }: { value: unknown }) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  return value.trim() || null;
};

export class SavePlatformBenchmarkDto {
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  platform: string;

  @IsOptional()
  @Transform(optionalTrim)
  @IsString()
  @MaxLength(100)
  brand?: string | null;

  @IsEnum(VideoType)
  videoType: VideoType;

  @Transform(trim)
  @IsString()
  @MaxLength(100)
  metricName: string;

  @IsNumber({ allowInfinity: false, allowNaN: false, maxDecimalPlaces: 4 })
  @Min(0)
  sThreshold: number;

  @IsNumber({ allowInfinity: false, allowNaN: false, maxDecimalPlaces: 4 })
  @Min(0)
  aThreshold: number;

  @IsNumber({ allowInfinity: false, allowNaN: false, maxDecimalPlaces: 4 })
  @Min(0)
  bThreshold: number;

  @IsNumber({ allowInfinity: false, allowNaN: false, maxDecimalPlaces: 4 })
  @Min(0)
  cThreshold: number;

  @IsIn(['higher_is_better', 'lower_is_better'])
  direction: 'higher_is_better' | 'lower_is_better';

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
