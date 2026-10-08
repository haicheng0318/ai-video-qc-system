import { IsInt, IsString, MaxLength, Min } from 'class-validator';
import { CreateVideoRevisionDto } from './create-video-revision.dto';

export class CreateDirectVideoRevisionDto extends CreateVideoRevisionDto {
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
