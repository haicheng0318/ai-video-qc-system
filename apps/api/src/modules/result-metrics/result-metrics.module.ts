import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module';
import { ResultMetricsController } from './result-metrics.controller';
import { ResultMetricsService } from './result-metrics.service';

@Module({
  imports: [PermissionsModule],
  controllers: [ResultMetricsController],
  providers: [ResultMetricsService],
})
export class ResultMetricsModule {}
