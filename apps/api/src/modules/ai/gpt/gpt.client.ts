import OpenAI from 'openai';
import { OpenAiConfigurationError, OpenAiRequestError, OpenAiRequestTimeoutError } from './gpt.errors';

export const OPENAI_CLIENT = Symbol('OPENAI_CLIENT');

export type OpenAiResultReviewRequest = {
  model: string;
  developerPrompt: string;
  inputContext: unknown;
  jsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
};

export type OpenAiResultReviewResponse = {
  responseId: string;
  responseStatus: string;
  model: string;
  rawText: string;
  refusal?: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

export type OpenAiFinalEvaluationRequest = OpenAiResultReviewRequest;
export type OpenAiFinalEvaluationResponse = OpenAiResultReviewResponse;

export interface OpenAiClient {
  createResultReview(request: OpenAiResultReviewRequest): Promise<OpenAiResultReviewResponse>;
  createFinalEvaluation(request: OpenAiFinalEvaluationRequest): Promise<OpenAiFinalEvaluationResponse>;
}

function requestTimeoutMs() {
  const value = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS || 120_000);
  return Number.isInteger(value) && value > 0 ? value : 120_000;
}

export class OpenAiResponsesClient implements OpenAiClient {
  constructor(
    private readonly sdkFactory: (apiKey: string, timeout: number) => OpenAI =
      (apiKey, timeout) => new OpenAI({ apiKey, timeout }),
  ) {}

  async createResultReview(request: OpenAiResultReviewRequest): Promise<OpenAiResultReviewResponse> {
    return this.createStructuredResponse(request, 'video_result_review', 'result review');
  }

  async createFinalEvaluation(request: OpenAiFinalEvaluationRequest): Promise<OpenAiFinalEvaluationResponse> {
    return this.createStructuredResponse(request, 'video_final_evaluation', 'final evaluation');
  }

  private async createStructuredResponse(
    request: OpenAiResultReviewRequest,
    schemaName: 'video_result_review' | 'video_final_evaluation',
    operation: 'result review' | 'final evaluation',
  ): Promise<OpenAiResultReviewResponse> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new OpenAiConfigurationError(`OpenAI ${operation} is not configured.`);

    try {
      const response = await this.sdkFactory(apiKey, requestTimeoutMs()).responses.create({
        model: request.model,
        store: false,
        instructions: request.developerPrompt,
        input: [{
          role: 'user',
          content: [{ type: 'input_text', text: JSON.stringify(request.inputContext) }],
        }],
        text: {
          format: {
            type: 'json_schema',
            name: schemaName,
            strict: true,
            schema: request.jsonSchema,
          },
        },
        max_output_tokens: request.maxOutputTokens,
      });
      const refusal = response.output.flatMap((item) =>
        item.type === 'message' ? item.content : []).find((item) => item.type === 'refusal');
      return {
        responseId: response.id,
        responseStatus: response.status || 'unknown',
        model: response.model,
        rawText: response.output_text,
        refusal: refusal?.type === 'refusal' ? refusal.refusal : undefined,
        usage: {
          inputTokens: response.usage?.input_tokens || 0,
          outputTokens: response.usage?.output_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      if (error instanceof OpenAiConfigurationError) throw error;
      if (error instanceof OpenAI.APIConnectionTimeoutError) {
        throw new OpenAiRequestTimeoutError(`OpenAI ${operation} request timed out.`);
      }
      throw new OpenAiRequestError(`OpenAI ${operation} request failed.`, error);
    }
  }
}
