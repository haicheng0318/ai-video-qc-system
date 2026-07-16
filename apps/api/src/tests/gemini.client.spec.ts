import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeminiClient } from '../modules/ai/gemini/gemini.client';
import { GeminiFileProcessingError, GeminiFileProcessingTimeoutError, GeminiRequestError } from '../modules/ai/gemini/gemini.errors';

const rawResponse = JSON.stringify({
  contentSummary: '内容清晰',
  totalScore: 90,
  contentGrade: 'S',
  isPublishableRecommendation: true,
  mainProblems: [],
  revisionSuggestions: [],
  complianceRisks: [],
  usableScenarios: ['投放'],
  scores: [{ dimension: '信息表达', score: 10, maxScore: 10, comment: '清晰' }],
});

test('Gemini client uploads, polls to ACTIVE, and generates JSON', async () => {
  const states = ['PROCESSING', 'ACTIVE'];
  let getCalls = 0;
  let request: Record<string, unknown> | undefined;
  const client = new GeminiClient(() => ({
    files: {
      upload: async () => ({ name: 'files/test', uri: 'https://example.test/file', mimeType: 'video/mp4', state: states[0] }),
      get: async () => ({ name: 'files/test', uri: 'https://example.test/file', mimeType: 'video/mp4', state: states[++getCalls] }),
    },
    models: {
      generateContent: async (input) => {
        request = input;
        return { text: rawResponse };
      },
    },
  }), { pollIntervalMs: 0, maxPollAttempts: 2 });

  const result = await client.analyzeVideo('/safe/video.mp4', 'video/mp4', 'gemini-test', 'evaluate content');
  assert.equal(result.rawResponse, rawResponse);
  assert.equal(request?.model, 'gemini-test');
  assert.deepEqual((request?.config as { responseMimeType: string }).responseMimeType, 'application/json');
});

test('Gemini client maps FAILED file processing to a safe error', async () => {
  const client = new GeminiClient(() => ({
    files: {
      upload: async () => ({ name: 'files/test', uri: 'https://example.test/file', state: 'FAILED' }),
      get: async () => ({ name: 'files/test', uri: 'https://example.test/file', state: 'FAILED' }),
    },
    models: { generateContent: async () => ({ text: rawResponse }) },
  }), { pollIntervalMs: 0, maxPollAttempts: 1 });

  await assert.rejects(
    client.analyzeVideo('/safe/video.mp4', 'video/mp4', 'gemini-test', 'evaluate content'),
    GeminiFileProcessingError,
  );
});

test('Gemini client stops polling after the configured maximum', async () => {
  const client = new GeminiClient(() => ({
    files: {
      upload: async () => ({ name: 'files/test', uri: 'https://example.test/file', state: 'PROCESSING' }),
      get: async () => ({ name: 'files/test', uri: 'https://example.test/file', state: 'PROCESSING' }),
    },
    models: { generateContent: async () => ({ text: rawResponse }) },
  }), { pollIntervalMs: 0, maxPollAttempts: 1 });

  await assert.rejects(
    client.analyzeVideo('/safe/video.mp4', 'video/mp4', 'gemini-test', 'evaluate content'),
    GeminiFileProcessingTimeoutError,
  );
});

test('Gemini request error preserves the SDK error as internal cause', async () => {
  const sdkError = new Error('SDK request failed with sensitive details');
  const client = new GeminiClient(() => ({
    files: {
      upload: async () => {
        throw sdkError;
      },
      get: async () => ({ name: 'files/test', uri: 'https://example.test/file', state: 'ACTIVE' }),
    },
    models: { generateContent: async () => ({ text: rawResponse }) },
  }));

  await assert.rejects(
    client.analyzeVideo('/safe/video.mp4', 'video/mp4', 'gemini-test', 'evaluate content'),
    (error: unknown) => error instanceof GeminiRequestError && error.cause === sdkError,
  );
});
