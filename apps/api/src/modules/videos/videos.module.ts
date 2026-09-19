import { Module } from '@nestjs/common';
import { ContentReviewModule } from '../ai/gemini/gemini.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  imports: [PermissionsModule, ContentReviewModule],
  controllers: [VideosController],
  providers: [VideosService],
  exports: [VideosService],
})
export class VideosModule {}
