import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { QwenStructuredTextClient } from '../modules/ai/gpt/gpt.client';
import { QwenClient } from '../modules/ai/gemini/qwen.client';
import { createServer } from 'node:http';
import { GptService } from '../modules/ai/gpt/gpt.service';

test('collector failure preserves received text response and usage for business failure audit without a second model call', async () => {
  let calls = 0;
  const response = { responseId: 'received', responseStatus: 'completed', model: 'fake', rawText: '{"received":true}', usageAvailable: true, usage: { inputTokens: 13, outputTokens: 7, totalTokens: 20 } };
  const service = new GptService({ createResultReview: async () => { calls++; return response; } } as any, { recordUsage: async () => { throw new Error('collector unavailable'); } } as any);
  await assert.rejects(service.reviewResultData({ model: 'fake', developerPrompt: '', inputContext: {}, maxOutputTokens: 1 }), (error: any) => error.audit?.rawText === response.rawText && error.audit?.usage.inputTokens === 13);
  assert.equal(calls, 1);
});

test('stream interruption preserves observed usage and partial response even when collection fails', async () => {
  const observed: any[] = [];
  const c = new QwenClient(() => ({ oss: { put: async () => {}, delete: async () => {}, signatureUrl: () => 'https://fake' }, qwen: { chat: { completions: { create: async () => (async function* () { yield { choices: [{ delta: { content: '{"partial":' } }], usage: { prompt_tokens: 13, completion_tokens: 7 } }; throw new Error('interrupted'); })() } } } }), { storage: async () => {}, usage: async usage => { observed.push(usage); throw new Error('collector unavailable'); } });
  await assert.rejects(c.analyzeVideo('/fake.mp4', 'video/mp4', 'fake', ''), (e: any) => e.audit?.rawResponse === '{"partial":' && e.audit?.usage.inputTokens === 13);
  assert.deepEqual(observed, [{ inputTokens: 13, outputTokens: 7 }]);
});

test('absent provider usage is explicitly unknown rather than an observed zero', async () => {
  process.env.DASHSCOPE_API_KEY = 'isolated-fake-key';
  const c = new QwenStructuredTextClient(() => ({ chat: { completions: { create: async () => ({ choices: [{ message: { content: '{}' } }] }) } } }));
  const response = await c.createResultReview({ model: 'fake', developerPrompt: '', inputContext: {}, jsonSchema: {}, maxOutputTokens: 1 });
  assert.equal((response as any).usageAvailable, false);
});

test('stream usage is captured and failed OSS cleanup is persistently observed', async () => {
  const events: string[] = [];
  const ctor: any = QwenClient;
  const c = new ctor(() => ({ oss: { put: async () => {}, delete: async () => { throw new Error('secret'); }, signatureUrl: () => 'https://fake' }, qwen: { chat: { completions: { create: async () => (async function* () { yield { choices: [{ delta: { content: '{}' } }] }; yield { usage: { prompt_tokens: 13, completion_tokens: 7 } }; })() } } } }), { storage: async (_path: string, status: string) => { events.push(status); }, usage: async (usage: any) => { assert.deepEqual(usage, { inputTokens: 13, outputTokens: 7 }); events.push('usage'); } });
  await assert.rejects(c.analyzeVideo('/fake.mp4', 'video/mp4', 'fake', ''), /cleanup/);
  assert.deepEqual(events, ['uploading', 'uploaded', 'usage', 'cleanup_failed']);
});

test('one recorded SDK request never silently retries a possibly billable failure', async () => {
  let requests = 0;
  const server = createServer((_req, res) => { requests++; res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"local fixture"}}'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const previous = process.env.QWEN_BASE_URL;
  process.env.QWEN_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}/v1`;
  process.env.DASHSCOPE_API_KEY = 'local-test-only';
  try {
    await assert.rejects(new QwenStructuredTextClient().createResultReview({ model: 'fake', developerPrompt: '', inputContext: {}, jsonSchema: {}, maxOutputTokens: 1 }));
    assert.equal(requests, 1, 'SDK retries must not bypass the durable attempt and usage ledger');
  } finally { if (previous === undefined) delete process.env.QWEN_BASE_URL; else process.env.QWEN_BASE_URL = previous; await new Promise<void>(resolve => server.close(() => resolve())); }
});
