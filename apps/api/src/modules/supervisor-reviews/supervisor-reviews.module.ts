import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module';
import { SupervisorReviewsController } from './supervisor-reviews.controller';
import { SupervisorReviewsService } from './supervisor-reviews.service';

@Module({
  imports: [PermissionsModule],
  controllers: [SupervisorReviewsController],
  providers: [SupervisorReviewsService],
  exports: [SupervisorReviewsService],
})
export class SupervisorReviewsModule {}
