import { Module } from '@nestjs/common';
import { AdminController, AdminGuard } from './admin.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminOperationsController } from './admin-operations.controller';
import { AdminOperationsService } from './admin-operations.service';
import { EvaluationJobsModule } from '../evaluation-jobs/evaluation-jobs.module';
import { ContentReviewModule } from '../ai/gemini/gemini.module';
import { ResultReviewsModule } from '../result-reviews/result-reviews.module';
import { FinalEvaluationsModule } from '../final-evaluations/final-evaluations.module';
@Module({ imports: [EvaluationJobsModule, ContentReviewModule, ResultReviewsModule, FinalEvaluationsModule], controllers: [AdminController, AdminOperationsController], providers: [AdminUsersService, AdminGuard, AdminOperationsService], exports: [AdminOperationsService] })
export class AdminModule {}
