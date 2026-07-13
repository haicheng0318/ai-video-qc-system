import { Injectable } from '@nestjs/common';

@Injectable()
export class GptService {
  readonly provider = 'openai_gpt';

  isIntegrationEnabled() {
    return false;
  }
}
