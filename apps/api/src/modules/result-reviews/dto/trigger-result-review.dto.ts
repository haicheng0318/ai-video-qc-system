import { IsUUID } from 'class-validator';

export class TriggerResultReviewDto {
  @IsUUID()
  resultMetricId!: string;
}
