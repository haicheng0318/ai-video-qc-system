import { Injectable } from '@nestjs/common';

@Injectable()
export class GeminiService {
  readonly provider = 'gemini';

  isIntegrationEnabled() {
    return false;
  }
}
