import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ManagementDenialInterceptor } from './modules/auth/management-denial.interceptor';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { OperationLogsModule } from './modules/operation-logs/operation-logs.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { UsersModule } from './modules/users/users.module';
import { VideosModule } from './modules/videos/videos.module';
import { ContentReviewModule } from './modules/ai/gemini/gemini.module';
import { GptModule } from './modules/ai/gpt/gpt.module';
import { RuleEngineModule } from './modules/rule-engine/rule-engine.module';
import { HealthController } from './health.controller';
import { SupervisorReviewsModule } from './modules/supervisor-reviews/supervisor-reviews.module';
import { ResultMetricsModule } from './modules/result-metrics/result-metrics.module';
import { ResultReviewsModule } from './modules/result-reviews/result-reviews.module';
import { FinalEvaluationsModule } from './modules/final-evaluations/final-evaluations.module';
import { FinalConfirmationsModule } from './modules/final-confirmations/final-confirmations.module';
import { CasesModule } from './modules/cases/cases.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { PlatformBenchmarksModule } from './modules/platform-benchmarks/platform-benchmarks.module';
import { StorageModule } from './modules/storage/storage.module';
import { QuotasModule } from './modules/quotas/quotas.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 10,
      },
    ]),
    PrismaModule,
    QuotasModule,
    AdminModule,
    StorageModule,
    OperationLogsModule,
    PermissionsModule,
    UsersModule,
    AuthModule,
    VideosModule,
    ContentReviewModule,
    GptModule,
    RuleEngineModule,
    SupervisorReviewsModule,
    ResultMetricsModule,
    ResultReviewsModule,
    FinalEvaluationsModule,
    FinalConfirmationsModule,
    CasesModule,
    DashboardModule,
    PlatformBenchmarksModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: ManagementDenialInterceptor }],
})
export class AppModule {}
