import { Module } from '@nestjs/common';
import { GeminiModule } from '../ai/gemini/gemini.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  imports: [PermissionsModule, GeminiModule],
  controllers: [VideosController],
  providers: [VideosService],
  exports: [VideosService],
})
export class VideosModule {}
