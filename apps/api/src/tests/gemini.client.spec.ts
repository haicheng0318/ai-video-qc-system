import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QwenClient } from '../modules/ai/gemini/qwen.client';
import {
  ContentReviewFileProcessingError,
  ContentReviewRequestError,
} from '../modules/ai/gemini/gemini.errors';
import { contentDimensionCodes } from '../modules/ai/gemini/content-scoring';

const rawResponse = JSON.stringify({
  contentSummary: '内容清晰',
  isPublishableRecommendation: true,
  mainProblems: [],
  revisionSuggestions: [],
  complianceRisks: [],
  usableScenarios: ['投放'],
  scores: contentDimensionCodes.map((dimension) => ({
    dimension, rating: 5, evidence: `${dimension}证据充分`, timestamp: null,
  })),
});

async function* chunks(parts: string[]) {
  for (const content of parts) yield { choices: [{ delta: { content } }] };
}

test('Qwen client uploads a private temporary video, streams JSON, and deletes the object', async () => {
  const calls: Array<Record<string, unknown>> = [];
  let request: Record<string, unknown> | undefined;
  const client = new QwenClient(() => ({
    oss: {
      put: async (name, filePath, options) => {
        calls.push({ action: 'put', name, filePath, options });
      },
      signatureUrlV4: async (_method, expires, _options, name) => {
        calls.push({ action: 'sign', name, expires });
        return 'https://private.example.test/video?signature=redacted';
      },
      delete: async (name) => {
        calls.push({ action: 'delete', name });
      },
    },
    qwen: {
      chat: {
        completions: {
          create: async (input) => {
            request = input;
            return chunks([rawResponse.slice(0, 20), rawResponse.slice(20)]);
          },
        },
      },
    },
  }));

  const result = await client.analyzeVideo('/safe/video.mp4', 'video/mp4', 'qwen3.5-omni-plus', 'evaluate');

  assert.equal(result.rawResponse, rawResponse);
  assert.equal(request?.model, 'qwen3.5-omni-plus');
  assert.equal((request?.response_format as { type: string }).type, 'json_schema');
  const messages = request?.messages as Array<{ content: Array<{ video_url?: { url: string } }> }>;
  assert.match(messages[0].content[0].video_url?.url || '', /^https:\/\/private\.example\.test/);
  assert.deepEqual(calls.map((call) => call.action), ['put', 'sign', 'delete']);
  assert.match(String(calls[0].name), /^ai-video-qc\/content-review\/[0-9a-f-]+\.mp4$/);
  assert.equal((calls[0].options as Record<string, unknown>).timeout, 300_000);
});

test('Qwen client applies configured OSS upload timeout', async () => {
  const originalTimeout = process.env.OSS_REQUEST_TIMEOUT_MS;
  process.env.OSS_REQUEST_TIMEOUT_MS = '180000';
  let observedTimeout: unknown;

  try {
    const client = new QwenClient(() => ({
      oss: {
        put: async (_name, _filePath, options) => {
          observedTimeout = options?.timeout;
        },
        signatureUrlV4: async () => 'https://private.example.test/video',
        delete: async () => undefined,
      },
      qwen: {
        chat: { completions: { create: async () => chunks([rawResponse]) } },
      },
    }));

    await client.analyzeVideo('/safe/video.mp4', 'video/mp4', 'qwen-test', 'evaluate');
    assert.equal(observedTimeout, 180_000);
  } finally {
    if (originalTimeout === undefined) delete process.env.OSS_REQUEST_TIMEOUT_MS;
    else process.env.OSS_REQUEST_TIMEOUT_MS = originalTimeout;
  }
});

test('Qwen client deletes the temporary object after a model request failure', async () => {
  const sdkError = new Error('request failed with sensitive details');
  let deleted = false;
  const client = new QwenClient(() => ({
    oss: {
      put: async () => undefined,
      signatureUrlV4: async () => 'https://private.example.test/video',
      delete: async () => { deleted = true; },
    },
    qwen: {
      chat: { completions: { create: async () => { throw sdkError; } } },
    },
  }));

  await assert.rejects(
    client.analyzeVideo('/safe/video.mp4', 'video/mp4', 'qwen-test', 'evaluate'),
    (error: unknown) => error instanceof ContentReviewRequestError && error.cause === sdkError,
  );
  assert.equal(deleted, true);
});

test('Qwen client treats failed temporary object cleanup as a review failure', async () => {
  const client = new QwenClient(() => ({
    oss: {
      put: async () => undefined,
      signatureUrlV4: async () => 'https://private.example.test/video',
      delete: async () => { throw new Error('delete failed'); },
    },
    qwen: {
      chat: { completions: { create: async () => chunks([rawResponse]) } },
    },
  }));

  await assert.rejects(
    client.analyzeVideo('/safe/video.mp4', 'video/mp4', 'qwen-test', 'evaluate'),
    ContentReviewFileProcessingError,
  );
});
