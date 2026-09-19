import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { StorageModule } from '../storage/storage.module';
import { ContentReviewModule } from '../ai/gemini/gemini.module';
import { ResultReviewsModule } from '../result-reviews/result-reviews.module';
import { FinalEvaluationsModule } from '../final-evaluations/final-evaluations.module';
import { EvaluationJobsModule } from './evaluation-jobs.module';
import { EvaluationWorker } from './evaluation-worker';

@Module({
  imports: [PrismaModule, OperationLogsModule, StorageModule, ContentReviewModule,
    ResultReviewsModule, FinalEvaluationsModule, EvaluationJobsModule],
  providers: [EvaluationWorker],
})
export class EvaluationWorkerModule {}
