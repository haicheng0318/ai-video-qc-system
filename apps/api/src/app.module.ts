import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    PrismaModule,
    OperationLogsModule,
    PermissionsModule,
    UsersModule,
    AuthModule,
    VideosModule,
    GeminiModule,
    GptModule,
    RuleEngineModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
