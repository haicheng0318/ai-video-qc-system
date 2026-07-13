import { Global, Module } from '@nestjs/common';
import { OperationLogsService } from './operation-logs.service';

@Global()
@Module({
  providers: [OperationLogsService],
  exports: [OperationLogsService],
})
export class OperationLogsModule {}
