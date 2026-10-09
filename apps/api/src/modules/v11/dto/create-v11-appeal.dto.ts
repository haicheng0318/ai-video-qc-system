import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateV11AppealDto {
  @IsIn(['content', 'data', 'comprehensive'])
  stage!: 'content' | 'data' | 'comprehensive';

  @IsUUID()
  resultId!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(/^\d{2}:\d{2}(?::\d{2})?$/, { each: true })
  timestamps?: string[];
}
