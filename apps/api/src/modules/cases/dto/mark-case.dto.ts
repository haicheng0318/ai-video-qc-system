import { Transform } from 'class-transformer';
import { IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { caseTypes } from '@ai-video-qc/shared';

export class MarkCaseDto {
  @IsUUID()
  evaluationId!: string;

  @IsIn(caseTypes)
  caseType!: 'excellent' | 'negative' | 'none';

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
