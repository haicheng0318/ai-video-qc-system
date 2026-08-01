import { Inject, Injectable } from '@nestjs/common';
import { OpenAiClient, OPENAI_CLIENT } from './gpt.client';
import {
  OpenAiRefusalError,
  OpenAiResponseError,
  ResultReviewOutputValidationError,
} from './gpt.errors';
import { resultReviewJsonSchema, validateResultReviewOutput } from './gpt-result-review.schema';

@Injectable()
export class GptService {
  readonly provider = 'openai';

  constructor(@Inject(OPENAI_CLIENT) private readonly client: OpenAiClient) {}

  async reviewResultData(input: {
    model: string;
    developerPrompt: string;
    inputContext: unknown;
    maxOutputTokens: number;
  }) {
    const response = await this.client.createResultReview({
      ...input,
      jsonSchema: resultReviewJsonSchema,
    });
    if (response.responseStatus !== 'completed') {
      throw new OpenAiResponseError('OpenAI result review response did not complete.', response);
    }
    if (response.refusal) {
      throw new OpenAiRefusalError('OpenAI refused the result review request.', response);
    }
    if (!response.rawText?.trim()) {
      throw new OpenAiResponseError('OpenAI result review returned empty output.', response);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.rawText);
    } catch {
      throw new ResultReviewOutputValidationError('OpenAI result review returned invalid JSON.', response);
    }

    return {
      ...response,
      parsedOutput: (() => {
        try {
          return validateResultReviewOutput(parsed);
        } catch (error) {
          if (error instanceof ResultReviewOutputValidationError) {
            throw new ResultReviewOutputValidationError(error.message, response);
          }
          throw error;
        }
      })(),
    };
  }
}
