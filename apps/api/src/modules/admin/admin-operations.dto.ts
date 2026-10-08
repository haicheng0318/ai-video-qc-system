import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class OperationsQueryDto {
  @IsOptional() @IsIn(['all', 'formal', 'trial']) scope?: string;
  @IsOptional() @IsString() @MaxLength(100) modelName?: string;
  @IsOptional() @IsString() @MaxLength(100) actionType?: string;
  @IsOptional() @IsString() @MaxLength(50) targetType?: string;
  @IsOptional() @IsString() @MaxLength(100) targetId?: string;
  @IsOptional() @IsIn(['success', 'failure', 'denied', 'started']) result?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsIn(['content', 'result', 'final']) stage?: string;
  @IsOptional() @IsIn(['queued', 'running', 'retry_wait', 'failed', 'needs_attention', 'succeeded', 'uncertain', 'started']) status?: string;
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsUUID() videoId?: string;
  @IsOptional() @IsISO8601({ strict: true }) from?: string;
  @IsOptional() @IsISO8601({ strict: true }) to?: string;
}
export class ControlledActionDto {
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsBoolean() confirmed!: boolean;
}
export class SaveSettingDto extends ControlledActionDto {
  @IsObject() value!: Record<string, unknown>;
  @IsInt() @Min(0) expectedVersion!: number;
}
