import { Module } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { RolesGuard } from './roles.guard';

@Module({
  providers: [PermissionsService, RolesGuard],
  exports: [PermissionsService, RolesGuard],
})
export class PermissionsModule {}
