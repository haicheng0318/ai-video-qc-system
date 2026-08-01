import { IsUUID, Matches } from 'class-validator';

const strictUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ExecuteRuleEngineDto {
  @IsUUID()
  @Matches(strictUuidPattern)
  resultReviewId!: string;
}
