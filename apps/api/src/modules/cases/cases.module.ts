import { Module } from '@nestjs/common';
import { OperationLogsModule } from '../operation-logs/operation-logs.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';

@Module({
  imports: [PermissionsModule, OperationLogsModule],
  controllers: [CasesController],
  providers: [CasesService],
})
export class CasesModule {}
