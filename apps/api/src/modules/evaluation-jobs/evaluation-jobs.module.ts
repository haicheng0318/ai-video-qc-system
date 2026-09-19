import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { EvaluationJobsService } from './evaluation-jobs.service';
import { EvaluationJobsController } from './evaluation-jobs.controller';
import { QuotasModule } from '../quotas/quotas.module';

@Module({
  imports: [PrismaModule, PermissionsModule, QuotasModule],
  providers: [EvaluationJobsService],
  controllers: [EvaluationJobsController],
  exports: [EvaluationJobsService],
})
export class EvaluationJobsModule {}
