import { Inject, Injectable } from '@nestjs/common';
import { OpenAiClient, OPENAI_CLIENT } from './gpt.client';
import {
  FinalEvaluationOutputValidationError,
  OpenAiRefusalError,
  OpenAiResponseError,
  ResultReviewOutputValidationError,
} from './gpt.errors';
import { resultReviewJsonSchema, validateResultReviewOutput } from './gpt-result-review.schema';
import { finalEvaluationJsonSchema, validateFinalEvaluationOutput } from './gpt-final-evaluation.schema';
import { RecommendedBoundary } from '@ai-video-qc/shared';

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

  async generateFinalEvaluation(input: {
    model: string;
    developerPrompt: string;
    inputContext: unknown;
    maxOutputTokens: number;
    recommendedBoundary: RecommendedBoundary;
  }) {
    const response = await this.client.createFinalEvaluation({
      model: input.model,
      developerPrompt: input.developerPrompt,
      inputContext: input.inputContext,
      maxOutputTokens: input.maxOutputTokens,
      jsonSchema: finalEvaluationJsonSchema,
    });
    if (response.responseStatus !== 'completed') {
      throw new OpenAiResponseError('OpenAI final evaluation response did not complete.', response);
    }
    if (response.refusal) {
      throw new OpenAiRefusalError('OpenAI refused the final evaluation request.', response);
    }
    if (!response.rawText?.trim()) {
      throw new OpenAiResponseError('OpenAI final evaluation returned empty output.', response);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.rawText);
    } catch {
      throw new FinalEvaluationOutputValidationError('OpenAI final evaluation returned invalid JSON.', response);
    }
    try {
      return {
        ...response,
        parsedOutput: validateFinalEvaluationOutput(parsed, input.recommendedBoundary),
      };
    } catch (error) {
      if (error instanceof FinalEvaluationOutputValidationError) {
        throw new FinalEvaluationOutputValidationError(error.message, response);
      }
      throw error;
    }
  }
}
