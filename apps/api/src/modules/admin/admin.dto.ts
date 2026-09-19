import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { UserRole, UserStatus } from '@prisma/client';
import { QuotaKind, QuotaPeriod, quotaKinds } from '../quotas/quotas.service';
export class ReasonDto { @IsString() @MinLength(1) @MaxLength(500) reason: string; }
export class QuotaInputDto {
  @IsIn(quotaKinds) kind: QuotaKind;
  @IsIn(['daily', 'monthly', 'lifetime']) period: QuotaPeriod;
  @ValidateIf((_o, value) => value !== null) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) limit: number | null;
}
export class AdjustQuotaDto extends ReasonDto {
  @IsIn(quotaKinds) kind: QuotaKind;
  @IsIn(['daily', 'monthly', 'lifetime']) period: QuotaPeriod;
  @ValidateIf((_o, value) => value !== null) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) limit: number | null;
  @IsString() @MinLength(1) @MaxLength(200) businessKey: string;
}
export class CreateUserDto extends ReasonDto {
  @IsString() @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_.@-]{2,99}$/) account: string;
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsEnum(UserRole) role: UserRole;
  @IsOptional() @IsString() @MaxLength(100) department?: string | null;
  @IsOptional() @IsUUID() managerId?: string | null;
  @IsOptional() @IsISO8601({ strict: true }) expiresAt?: string | null;
  @IsOptional() @IsString() @MaxLength(128) initialPassword?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => QuotaInputDto) quotas?: QuotaInputDto[];
}
export class BatchUsersDto { @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => CreateUserDto) users: CreateUserDto[]; }
export class UpdateUserDto extends ReasonDto {
  @ValidateIf((_o, value) => value !== undefined) @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @ValidateIf((_o, value) => value !== undefined) @IsEnum(UserRole) role?: UserRole;
  @ValidateIf((_o, value) => value !== undefined) @IsEnum(UserStatus) status?: UserStatus;
  @IsOptional() @IsString() @MaxLength(100) department?: string | null;
  @IsOptional() @IsUUID() managerId?: string | null;
  @IsOptional() @IsISO8601({ strict: true }) expiresAt?: string | null;
}
export class UsersQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}
