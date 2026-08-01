import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module';
import { RuleEngineController } from './rule-engine.controller';
import { RuleEngineService } from './rule-engine.service';

@Module({
  imports: [PermissionsModule],
  controllers: [RuleEngineController],
  providers: [RuleEngineService],
  exports: [RuleEngineService],
})
export class RuleEngineModule {}
