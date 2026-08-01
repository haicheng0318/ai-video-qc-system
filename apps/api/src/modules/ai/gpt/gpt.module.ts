import { Module } from '@nestjs/common';
import { OPENAI_CLIENT, OpenAiResponsesClient } from './gpt.client';
import { GptService } from './gpt.service';

@Module({
  providers: [
    { provide: OPENAI_CLIENT, useFactory: () => new OpenAiResponsesClient() },
    GptService,
  ],
  exports: [GptService],
})
export class GptModule {}
