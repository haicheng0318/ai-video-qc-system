import { Module } from '@nestjs/common';
import { QwenStructuredTextClient, TEXT_MODEL_CLIENT } from './gpt.client';
import { GptService } from './gpt.service';
import { EvaluationJobsModule } from '../../evaluation-jobs/evaluation-jobs.module';

@Module({
  imports: [EvaluationJobsModule],
  providers: [
    { provide: TEXT_MODEL_CLIENT, useFactory: () => new QwenStructuredTextClient() },
    GptService,
  ],
  exports: [GptService],
})
export class GptModule {}
