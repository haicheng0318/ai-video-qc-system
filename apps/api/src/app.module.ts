import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { OperationLogsModule } from './modules/operation-logs/operation-logs.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { UsersModule } from './modules/users/users.module';
import { VideosModule } from './modules/videos/videos.module';
import { GeminiModule } from './modules/ai/gemini/gemini.module';
import { GptModule } from './modules/ai/gpt/gpt.module';
import { RuleEngineModule } from './modules/rule-engine/rule-engine.module';
import { HealthController } from './health.controller';
import { SupervisorReviewsModule } from './modules/supervisor-reviews/supervisor-reviews.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 10,
      },
    ]),
    PrismaModule,
    OperationLogsModule,
    PermissionsModule,
    UsersModule,
    AuthModule,
    VideosModule,
    GeminiModule,
    GptModule,
    RuleEngineModule,
    SupervisorReviewsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
