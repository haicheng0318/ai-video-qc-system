import OpenAI from 'openai';
import {
  TextModelConfigurationError,
  TextModelRequestError,
  TextModelRequestTimeoutError,
} from './gpt.errors';

export const TEXT_MODEL_CLIENT = Symbol('TEXT_MODEL_CLIENT');
const directFetch = globalThis.fetch.bind(globalThis);

export type StructuredTextRequest = {
  model: string;
  developerPrompt: string;
  inputContext: unknown;
  jsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
};

export type StructuredTextResponse = {
  usageCollectionStatus?: string;
  usageAvailable?: boolean;
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

type QwenChatCompletion = {
  id?: string;
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null; refusal?: string | null };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export type QwenTextSdk = {
  chat: {
    completions: {
      create(input: Record<string, unknown>): Promise<QwenChatCompletion>;
    };
  };
};

export interface StructuredTextClient {
  createResultReview(request: StructuredTextRequest): Promise<StructuredTextResponse>;
  createFinalEvaluation(request: StructuredTextRequest): Promise<StructuredTextResponse>;
}

function requestTimeoutMs() {
  const value = Number(process.env.QWEN_TEXT_REQUEST_TIMEOUT_MS || 120_000);
  return Number.isInteger(value) && value > 0 ? value : 120_000;
}

function qwenBaseUrl() {
  return process.env.QWEN_BASE_URL?.trim() || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
}

function defaultSdkFactory(apiKey: string, timeout: number): QwenTextSdk {
  return new OpenAI({ apiKey, baseURL: qwenBaseUrl(), timeout, fetch: directFetch, maxRetries: 0 }) as unknown as QwenTextSdk;
}

export class QwenStructuredTextClient implements StructuredTextClient {
  constructor(
    private readonly sdkFactory: (apiKey: string, timeout: number) => QwenTextSdk = defaultSdkFactory,
  ) {}

  async createResultReview(request: StructuredTextRequest): Promise<StructuredTextResponse> {
    return this.createStructuredResponse(request, 'video_result_review', 'result review');
  }

  async createFinalEvaluation(request: StructuredTextRequest): Promise<StructuredTextResponse> {
    return this.createStructuredResponse(request, 'video_final_evaluation', 'final evaluation');
  }

  private async createStructuredResponse(
    request: StructuredTextRequest,
    schemaName: 'video_result_review' | 'video_final_evaluation',
    operation: 'result review' | 'final evaluation',
  ): Promise<StructuredTextResponse> {
    const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
    if (!apiKey) throw new TextModelConfigurationError(`Qwen ${operation} is not configured.`);

    try {
      const response = await this.sdkFactory(apiKey, requestTimeoutMs()).chat.completions.create({
        model: request.model,
        messages: [
          {
            role: 'system',
            content: `${request.developerPrompt}\n\n必须仅返回符合下列 JSON Schema 的 JSON 对象；字段名、枚举值、必填项及 additionalProperties 限制均不可改变：\n${JSON.stringify(request.jsonSchema)}`,
          },
          { role: 'user', content: JSON.stringify(request.inputContext) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: schemaName,
            strict: true,
            schema: request.jsonSchema,
          },
        },
        max_tokens: request.maxOutputTokens,
        temperature: 0.2,
        // DashScope's Node.js OpenAI-compatible API expects this non-standard
        // option at the top level (not nested under extra_body).
        enable_thinking: false,
      });
      const choice = response.choices?.[0];
      const rawText = typeof choice?.message?.content === 'string' ? choice.message.content : '';
      const refusal = typeof choice?.message?.refusal === 'string' ? choice.message.refusal : undefined;
      const responseStatus = choice?.finish_reason === 'length'
        ? 'incomplete'
        : rawText.trim() || refusal
          ? 'completed'
          : 'incomplete';
      return {
        usageAvailable: Number.isSafeInteger(response.usage?.prompt_tokens) && Number.isSafeInteger(response.usage?.completion_tokens) && response.usage!.prompt_tokens! >= 0 && response.usage!.completion_tokens! >= 0,
        responseId: response.id || 'unknown',
        responseStatus,
        model: response.model || request.model,
        rawText,
        refusal,
        usage: {
          inputTokens: response.usage?.prompt_tokens || 0,
          outputTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      if (error instanceof TextModelConfigurationError) throw error;
      if (error instanceof OpenAI.APIConnectionTimeoutError) {
        throw new TextModelRequestTimeoutError(`Qwen ${operation} request timed out.`);
      }
      throw new TextModelRequestError(`Qwen ${operation} request failed.`, error);
    }
  }
}
