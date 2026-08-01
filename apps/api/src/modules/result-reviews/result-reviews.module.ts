import { Module } from '@nestjs/common';
import { GptModule } from '../ai/gpt/gpt.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { ResultReviewsController } from './result-reviews.controller';
import { ResultReviewsService } from './result-reviews.service';

@Module({
  imports: [GptModule, PermissionsModule],
  controllers: [ResultReviewsController],
  providers: [ResultReviewsService],
  exports: [ResultReviewsService],
})
export class ResultReviewsModule {}
