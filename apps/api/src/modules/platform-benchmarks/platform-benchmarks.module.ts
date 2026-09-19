import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module';
import { PlatformBenchmarksController } from './platform-benchmarks.controller';
import { PlatformBenchmarksService } from './platform-benchmarks.service';

@Module({
  imports: [PermissionsModule],
  controllers: [PlatformBenchmarksController],
  providers: [PlatformBenchmarksService],
})
export class PlatformBenchmarksModule {}
