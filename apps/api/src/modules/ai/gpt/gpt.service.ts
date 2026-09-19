import { Inject, Injectable, Optional } from '@nestjs/common';
import { EvaluationJobsService } from '../../evaluation-jobs/evaluation-jobs.service';
import { StructuredTextClient, TEXT_MODEL_CLIENT } from './gpt.client';
import {
  FinalEvaluationOutputValidationError,
  TextModelRefusalError,
  TextModelResponseError,
  ResultReviewOutputValidationError,
} from './gpt.errors';
import { resultReviewJsonSchema, validateResultReviewOutput } from './gpt-result-review.schema';
import { finalEvaluationJsonSchema, validateFinalEvaluationOutput } from './gpt-final-evaluation.schema';
import { RecommendedBoundary } from '@ai-video-qc/shared';

@Injectable()
export class GptService {
  readonly provider = 'aliyun_bailian';

  constructor(@Inject(TEXT_MODEL_CLIENT) private readonly client: StructuredTextClient, @Optional() private readonly jobs?: EvaluationJobsService) {}

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
    await this.collect(response);
    if (response.responseStatus !== 'completed') {
      throw new TextModelResponseError('Qwen result review response did not complete.', response);
    }
    if (response.refusal) {
      throw new TextModelRefusalError('Qwen refused the result review request.', response);
    }
    if (!response.rawText?.trim()) {
      throw new TextModelResponseError('Qwen result review returned empty output.', response);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.rawText);
    } catch {
      throw new ResultReviewOutputValidationError('Qwen result review returned invalid JSON.', response);
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
    await this.collect(response);
    if (response.responseStatus !== 'completed') {
      throw new TextModelResponseError('Qwen final evaluation response did not complete.', response);
    }
    if (response.refusal) {
      throw new TextModelRefusalError('Qwen refused the final evaluation request.', response);
    }
    if (!response.rawText?.trim()) {
      throw new TextModelResponseError('Qwen final evaluation returned empty output.', response);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.rawText);
    } catch {
      throw new FinalEvaluationOutputValidationError('Qwen final evaluation returned invalid JSON.', response);
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
  private async collect(response: import('./gpt.client').StructuredTextResponse) {
    try {
      await this.jobs?.recordUsage(response.usage, response.usageAvailable === true);
      response.usageCollectionStatus = response.usageAvailable ? 'collected' : 'unknown';
    } catch {
      response.usageCollectionStatus = 'failed';
      // Telemetry failure must not discard an already received paid response or reissue it.
      await this.jobs?.recordCollectionFailure?.().catch(() => undefined);
    }
  }
}
