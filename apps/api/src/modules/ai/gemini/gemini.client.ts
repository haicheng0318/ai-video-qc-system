import { GoogleGenAI, createPartFromUri } from '@google/genai';
import { GeminiConfigurationError, GeminiFileProcessingError, GeminiFileProcessingTimeoutError, GeminiRequestError } from './gemini.errors';
import { geminiResponseJsonSchema } from './gemini.schema';
import { GeminiAnalysisResult, GeminiFileReference } from './gemini.types';

export const GEMINI_CLIENT = Symbol('GEMINI_CLIENT');

type GeminiSdkFile = {
  name?: string;
  uri?: string;
  mimeType?: string;
  state?: string | { name?: string };
  error?: { message?: string };
};

export type GeminiSdk = {
  files: {
    upload(input: { file: string; config: { mimeType: string } }): Promise<GeminiSdkFile>;
    get(input: { name: string }): Promise<GeminiSdkFile>;
  };
  models: {
    generateContent(input: Record<string, unknown>): Promise<{ text?: string }>;
  };
};

export type GeminiSdkFactory = () => GeminiSdk;

type GeminiClientOptions = {
  pollIntervalMs?: number;
  maxPollAttempts?: number;
};

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function defaultSdkFactory(): GeminiSdk {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new GeminiConfigurationError('Gemini content review is not configured.');
  }
  return new GoogleGenAI({ apiKey }) as unknown as GeminiSdk;
}

function sleep(milliseconds: number) {
  return milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve();
}

function fileState(file: GeminiSdkFile) {
  return typeof file.state === 'string' ? file.state : file.state?.name;
}

export class GeminiClient {
  private readonly sdkFactory: GeminiSdkFactory;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;

  constructor(sdkFactory: GeminiSdkFactory = defaultSdkFactory, options: GeminiClientOptions = {}) {
    this.sdkFactory = sdkFactory;
    this.pollIntervalMs = options.pollIntervalMs ?? readPositiveInteger(process.env.GEMINI_FILE_POLL_INTERVAL_MS, 5000);
    this.maxPollAttempts = options.maxPollAttempts ?? readPositiveInteger(process.env.GEMINI_FILE_POLL_MAX_ATTEMPTS, 24);
  }

  async analyzeVideo(filePath: string, mimeType: string, modelName: string, prompt: string): Promise<GeminiAnalysisResult> {
    const sdk = this.sdkFactory();
    const uploaded = await sdk.files.upload({ file: filePath, config: { mimeType } });
    const file = await this.waitForActive(sdk, uploaded, mimeType);

    try {
      const response = await sdk.models.generateContent({
        model: modelName,
        contents: [prompt, createPartFromUri(file.uri, file.mimeType)],
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: geminiResponseJsonSchema,
        },
      });
      const rawResponse = response.text?.trim();
      if (!rawResponse) throw new GeminiRequestError('Gemini returned an empty response.');
      return { rawResponse };
    } catch (error) {
      if (error instanceof GeminiRequestError) throw error;
      throw new GeminiRequestError('Gemini content review request failed.');
    }
  }

  private async waitForActive(sdk: GeminiSdk, uploaded: GeminiSdkFile, mimeType: string): Promise<GeminiFileReference> {
    if (!uploaded.name || !uploaded.uri) {
      throw new GeminiFileProcessingError('Gemini file upload returned an incomplete file reference.');
    }

    let current = uploaded;
    for (let attempt = 0; attempt <= this.maxPollAttempts; attempt += 1) {
      const state = fileState(current);
      if (state === 'ACTIVE') {
        if (!current.name || !current.uri) {
          throw new GeminiFileProcessingError('Gemini file processing returned an incomplete file reference.');
        }
        return { name: current.name, uri: current.uri, mimeType: current.mimeType || mimeType };
      }
      if (state === 'FAILED') {
        throw new GeminiFileProcessingError('Gemini file processing failed.');
      }
      if (attempt === this.maxPollAttempts) break;
      await sleep(this.pollIntervalMs);
      current = await sdk.files.get({ name: uploaded.name });
    }

    throw new GeminiFileProcessingTimeoutError('Gemini file processing timed out.');
  }
}
