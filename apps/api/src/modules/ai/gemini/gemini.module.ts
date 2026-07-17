import { Module } from '@nestjs/common';
import { PermissionsModule } from '../../permissions/permissions.module';
import { GeminiClient, GEMINI_CLIENT } from './gemini.client';
import { GeminiService } from './gemini.service';

@Module({
  imports: [PermissionsModule],
  providers: [
    {
      provide: GEMINI_CLIENT,
      useFactory: () => new GeminiClient(),
    },
    GeminiService,
  ],
  exports: [GeminiService],
})
export class GeminiModule {}
