import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { finalGrades } from '@ai-video-qc/shared';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class CreateFinalConfirmationDto {
  @IsUUID()
  evaluationId!: string;

  @IsIn(finalGrades)
  finalGrade!: 'effective' | 'low_effective' | 'invalid';

  @IsBoolean()
  canBeUsedForPerformance!: boolean;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1500)
  confirmationComment?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  manualAdjustReason?: string;
}
