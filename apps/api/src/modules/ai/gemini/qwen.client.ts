import OSS = require('ali-oss');
import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import {
  ContentReviewConfigurationError,
  ContentReviewFileProcessingError,
  ContentReviewRequestError,
} from './gemini.errors';
import { contentReviewResponseJsonSchema } from './gemini.schema';
import { VideoContentAnalysisResult } from './gemini.types';

export const QWEN_CLIENT = Symbol('QWEN_CLIENT');
const directFetch = globalThis.fetch.bind(globalThis);

type QwenChunk = {
  choices?: Array<{ delta?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export type QwenSdk = {
  chat: {
    completions: {
      create(input: Record<string, unknown>): Promise<AsyncIterable<QwenChunk>>;
    };
  };
};

export type QwenOssClient = {
  put(name: string, filePath: string, options?: Record<string, unknown>): Promise<unknown>;
  delete(name: string): Promise<unknown>;
  signatureUrlV4?(
    method: 'GET',
    expires: number,
    options: Record<string, unknown>,
    name: string,
  ): Promise<string>;
  signatureUrl?(name: string, options: { expires: number }): string;
};

export type QwenClientDependencies = {
  qwen: QwenSdk;
  oss: QwenOssClient;
};

export type QwenClientFactory = () => QwenClientDependencies;

function requireEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new ContentReviewConfigurationError(`${name} is required.`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultFactory(): QwenClientDependencies {
  const qwen = new OpenAI({
    apiKey: requireEnvironment('DASHSCOPE_API_KEY'),
    baseURL: process.env.QWEN_BASE_URL?.trim() || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    fetch: directFetch,
    maxRetries: 0,
  }) as unknown as QwenSdk;
  const oss = new OSS({
    region: requireEnvironment('OSS_REGION'),
    bucket: requireEnvironment('OSS_BUCKET'),
    accessKeyId: requireEnvironment('OSS_ACCESS_KEY_ID'),
    accessKeySecret: requireEnvironment('OSS_ACCESS_KEY_SECRET'),
    endpoint: process.env.OSS_ENDPOINT?.trim() || undefined,
    secure: true,
    authorizationV4: true,
  }) as unknown as QwenOssClient;
  return { qwen, oss };
}

function safeExtension(filePath: string) {
  const extension = extname(filePath).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : '.mp4';
}

function extractChunkText(chunk: QwenChunk) {
  const content = chunk.choices?.[0]?.delta?.content;
  return typeof content === 'string' ? content : '';
}

export class QwenClient {
  private readonly factory: QwenClientFactory;
  private readonly ossRequestTimeoutMs: number;
  private readonly signedUrlTtlSeconds: number;
  private readonly temporaryPrefix: string;

  constructor(factory: QwenClientFactory = defaultFactory, private readonly observer?: { storage: (path: string, status: 'uploading' | 'uploaded' | 'cleaned' | 'cleanup_failed') => Promise<void>; usage: (usage: { inputTokens?: number; outputTokens?: number } | undefined) => Promise<void> }) {
    this.factory = factory;
    this.ossRequestTimeoutMs = positiveInteger(process.env.OSS_REQUEST_TIMEOUT_MS, 300_000);
    this.signedUrlTtlSeconds = positiveInteger(process.env.OSS_SIGNED_URL_TTL_SECONDS, 3600);
    this.temporaryPrefix = (process.env.OSS_TEMP_PREFIX?.trim() || 'ai-video-qc/content-review')
      .replace(/^\/+|\/+$/g, '');
  }

  async analyzeVideo(
    filePath: string,
    mimeType: string,
    modelName: string,
    prompt: string,
  ): Promise<VideoContentAnalysisResult> {
    let dependencies: QwenClientDependencies | undefined;
    let objectName: string | undefined;
    let rawResponse: string | undefined;
    let failure: unknown;
    let text = '';
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;
    let usageCollectionStatus = 'unknown';

    try {
      dependencies = this.factory();
      objectName = `${this.temporaryPrefix}/${randomUUID()}${safeExtension(filePath)}`;
      await this.observer?.storage(objectName, 'uploading');
      await dependencies.oss.put(objectName, filePath, {
        timeout: this.ossRequestTimeoutMs,
        headers: {
          'Content-Type': mimeType,
          'x-oss-object-acl': 'private',
          'x-oss-forbid-overwrite': 'true',
        },
      });
      await this.observer?.storage(objectName, 'uploaded');
      const videoUrl = await this.createSignedUrl(dependencies.oss, objectName);
      const stream = await dependencies.qwen.chat.completions.create({
        model: modelName,
        stream: true,
        stream_options: { include_usage: true },
        modalities: ['text'],
        messages: [{
          role: 'user',
          content: [
            { type: 'video_url', video_url: { url: videoUrl } },
            { type: 'text', text: prompt },
          ],
        }],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'video_content_review',
            strict: true,
            schema: contentReviewResponseJsonSchema,
          },
        },
      });
      for await (const chunk of stream) {
        text += extractChunkText(chunk);
        if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens };
      }
      if (!text.trim()) throw new ContentReviewRequestError('Qwen returned an empty response.');
      rawResponse = text;
    } catch (error) {
      failure = error;
    }

    rawResponse = text || rawResponse;
    try { await this.observer?.usage(usage); usageCollectionStatus = usage ? 'collected' : 'unknown'; }
    catch { usageCollectionStatus = 'failed'; }

    if (dependencies && objectName) {
      try {
        await dependencies.oss.delete(objectName);
        await this.observer?.storage(objectName, 'cleaned');
      } catch (error) {
        await this.observer?.storage(objectName, 'cleanup_failed').catch(() => undefined);
        if (!failure) {
          failure = new ContentReviewFileProcessingError('Temporary OSS object cleanup failed.', error);
        }
      }
    }

    if (failure) {
      if (
        failure instanceof ContentReviewConfigurationError ||
        failure instanceof ContentReviewFileProcessingError ||
        failure instanceof ContentReviewRequestError
      ) {
        throw Object.assign(failure, { audit: { rawResponse, usage, usageCollectionStatus } });
      }
      throw Object.assign(new ContentReviewRequestError('Qwen content review request failed.', failure), { audit: { rawResponse, usage, usageCollectionStatus } });
    }
    if (!rawResponse) throw new ContentReviewRequestError('Qwen returned an empty response.');
    return { rawResponse, usage, usageCollectionStatus };
  }

  private async createSignedUrl(oss: QwenOssClient, objectName: string) {
    if (oss.signatureUrlV4) {
      return oss.signatureUrlV4('GET', this.signedUrlTtlSeconds, {}, objectName);
    }
    if (oss.signatureUrl) {
      return oss.signatureUrl(objectName, { expires: this.signedUrlTtlSeconds });
    }
    throw new ContentReviewFileProcessingError('OSS client cannot create a signed URL.');
  }
}
