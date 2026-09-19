import { IsInt, IsString, MaxLength, Min } from 'class-validator';
import { CreateVideoDto } from './create-video.dto';

export class CreateDirectVideoDto extends CreateVideoDto {
  @IsString()
  @MaxLength(1200)
  objectPath: string;

  @IsString()
  @MaxLength(255)
  originalFileName: string;

  @IsString()
  @MaxLength(100)
  mimeType: string;

  @IsInt()
  @Min(1)
  fileSizeBytes: number;
}
