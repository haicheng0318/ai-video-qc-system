import { Module } from '@nestjs/common';
import { EvaluationJobsModule } from '../../evaluation-jobs/evaluation-jobs.module';
import { PermissionsModule } from '../../permissions/permissions.module';
import { QwenClient, QWEN_CLIENT } from './qwen.client';
import { ContentReviewService } from './gemini.service';
import { EvaluationJobsService } from '../../evaluation-jobs/evaluation-jobs.service';

@Module({
  imports: [PermissionsModule, EvaluationJobsModule],
  providers: [
    {
      provide: QWEN_CLIENT,
      inject: [EvaluationJobsService],
      useFactory: (jobs: EvaluationJobsService) => new QwenClient(undefined, { storage: (path, status) => jobs.recordTemporaryStorage(path, status), usage: async usage => { try { await jobs.recordUsage(usage); } catch (error) { await jobs.recordCollectionFailure().catch(() => undefined); throw error; } } }),
    },
    ContentReviewService,
  ],
  exports: [ContentReviewService],
})
export class ContentReviewModule {}
