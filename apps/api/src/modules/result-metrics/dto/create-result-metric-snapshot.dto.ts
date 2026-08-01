import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

function OptionalText(maxLength: number) {
  return applyDecorators(
    IsOptional(),
    Transform(trim),
    IsString(),
    MaxLength(maxLength),
  );
}

function OptionalUrl() {
  return applyDecorators(
    IsOptional(),
    Transform(trim),
    IsUrl({ protocols: ['http', 'https'], require_protocol: true }),
    MaxLength(2048),
  );
}

function OptionalDate() {
  return applyDecorators(IsOptional(), IsDateString({ strict: true }));
}

function OptionalCount() {
  return applyDecorators(
    IsOptional(),
    Transform(({ value }) =>
      typeof value === 'string' && value.trim() !== '' ? Number(value) : value,
    ),
    IsInt(),
    Min(0),
  );
}

function OptionalDecimal(maxDecimalPlaces: number) {
  return applyDecorators(
    IsOptional(),
    Transform(({ value }) =>
      typeof value === 'string' && value.trim() !== '' ? Number(value) : value,
    ),
    IsNumber({ allowInfinity: false, allowNaN: false, maxDecimalPlaces }),
    Min(0),
  );
}

export class CreateResultMetricSnapshotDto {
  @IsOptional()
  @IsUUID()
  baseMetricId?: string | null;

  @OptionalUrl()
  publishUrl?: string | null;

  @OptionalDate()
  publishDate?: string | null;

  @OptionalDate()
  dataStartDate?: string | null;

  @OptionalDate()
  dataEndDate?: string | null;

  @OptionalUrl()
  dataScreenshotUrl?: string | null;

  @OptionalText(255)
  campaignName?: string | null;

  @OptionalCount()
  impressions?: number | null;

  @OptionalCount()
  views?: number | null;

  @OptionalCount()
  clicks?: number | null;

  @OptionalDecimal(4)
  ctr?: number | null;

  @OptionalCount()
  productClicks?: number | null;

  @OptionalDecimal(4)
  productCtr?: number | null;

  @OptionalDecimal(2)
  spend?: number | null;

  @OptionalDecimal(4)
  cpc?: number | null;

  @OptionalDecimal(4)
  cpm?: number | null;

  @OptionalCount()
  orders?: number | null;

  @OptionalDecimal(2)
  gmv?: number | null;

  @OptionalDecimal(4)
  conversionRate?: number | null;

  @OptionalDecimal(4)
  cvr?: number | null;

  @OptionalDecimal(4)
  roi?: number | null;

  @OptionalCount()
  liveRoomEntries?: number | null;

  @OptionalDecimal(4)
  entryRate?: number | null;

  @OptionalDecimal(4)
  entryCost?: number | null;

  @OptionalCount()
  avgStaySeconds?: number | null;

  @OptionalCount()
  interactions?: number | null;

  @OptionalCount()
  liveOrders?: number | null;

  @OptionalDecimal(2)
  liveGmv?: number | null;

  @OptionalDecimal(4)
  threeSecondViewRate?: number | null;

  @OptionalDecimal(4)
  completionRate?: number | null;

  @OptionalCount()
  avgWatchSeconds?: number | null;

  @OptionalCount()
  likes?: number | null;

  @OptionalCount()
  comments?: number | null;

  @OptionalCount()
  shares?: number | null;

  @OptionalCount()
  saves?: number | null;

  @OptionalCount()
  followersGain?: number | null;

  @OptionalCount()
  brandSearchGrowth?: number | null;

  @OptionalCount()
  positiveCommentsCount?: number | null;

  @OptionalText(2000)
  commentKeywords?: string | null;

  @OptionalText(4000)
  operatorNote?: string | null;

  @OptionalText(4000)
  deliveryNote?: string | null;

  @OptionalText(100)
  planStatus?: string | null;
}
