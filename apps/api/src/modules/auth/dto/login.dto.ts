import { IsString, MinLength, MaxLength, IsBoolean, IsOptional } from 'class-validator';

export class LoginDto {
  @IsString()
  @MaxLength(100)
  account: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @IsOptional()
  @IsBoolean()
  adminOnly?: boolean;
}
