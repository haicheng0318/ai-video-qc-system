import { IsInt, IsString, MaxLength, Min } from 'class-validator';

export class CreateDirectUploadTicketDto {
  @IsString()
  @MaxLength(255)
  fileName: string;

  @IsString()
  @MaxLength(100)
  mimeType: string;

  @IsInt()
  @Min(1)
  fileSizeBytes: number;
}
