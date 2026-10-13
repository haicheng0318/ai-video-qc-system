import { Module } from '@nestjs/common';
import { ContentReviewModule } from '../ai/gemini/gemini.module';
import { EvaluationJobsModule } from '../evaluation-jobs/evaluation-jobs.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { StorageModule } from '../storage/storage.module';
import { V11ContentController } from './v11-content.controller';
import { V11ContentService } from './v11-content.service';
import { V11WorkflowController } from './v11-workflow.controller';
import { V11WorkflowService } from './v11-workflow.service';
import { V11RatingsController } from './v11-ratings.controller';
import { V11RatingsService } from './v11-ratings.service';

@Module({
  imports: [ContentReviewModule, EvaluationJobsModule, PermissionsModule, OperationLogsModule, StorageModule],
  controllers: [V11ContentController, V11WorkflowController, V11RatingsController],
  providers: [V11ContentService, V11WorkflowService, V11RatingsService],
  exports: [V11ContentService, V11WorkflowService, V11RatingsService],
})
export class V11Module {}
