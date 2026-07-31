import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum SupervisorReviewDecision {
  ApprovedForPublish = 'approved_for_publish',
  RevisionRequired = 'revision_required',
  InvalidContent = 'invalid_content',
}

export class CreateSupervisorReviewDto {
  @IsEnum(SupervisorReviewDecision)
  decision: SupervisorReviewDecision;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  comment?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  revisionRequirements?: string[];
}
