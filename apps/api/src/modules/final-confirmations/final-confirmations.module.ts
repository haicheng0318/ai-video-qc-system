import { Module } from '@nestjs/common';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { FinalConfirmationsController } from './final-confirmations.controller';
import { FinalConfirmationsService } from './final-confirmations.service';

@Module({
  imports: [PermissionsModule, OperationLogsModule],
  controllers: [FinalConfirmationsController],
  providers: [FinalConfirmationsService],
  exports: [FinalConfirmationsService],
})
export class FinalConfirmationsModule {}
