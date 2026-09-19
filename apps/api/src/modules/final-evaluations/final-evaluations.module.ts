import { Module } from '@nestjs/common';
import { EvaluationJobsModule } from '../evaluation-jobs/evaluation-jobs.module';
import { GptModule } from '../ai/gpt/gpt.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { FinalEvaluationsController } from './final-evaluations.controller';
import { FinalEvaluationsService } from './final-evaluations.service';

@Module({
  imports: [GptModule, PermissionsModule, EvaluationJobsModule],
  controllers: [FinalEvaluationsController],
  providers: [FinalEvaluationsService],
  exports: [FinalEvaluationsService],
})
export class FinalEvaluationsModule {}
