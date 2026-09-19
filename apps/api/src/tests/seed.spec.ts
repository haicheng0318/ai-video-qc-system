import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('seed uses the Qwen-Omni content review model and no reserved placeholder', async () => {
  const seed = await readFile(resolve(process.cwd(), '../../prisma/seed.cjs'), 'utf8');
  assert.match(seed, /provider: 'aliyun_bailian'/);
  assert.match(seed, /modelName: 'qwen3\.5-omni-plus'/);
  assert.match(seed, /modelName: 'qwen3\.5-omni-plus',[\s\S]*?enabled: true/);
  assert.doesNotMatch(seed, /reserved-gemini-video-model/);
  assert.doesNotMatch(seed, /Gemini content review schema will be added in phase 2/);
  assert.match(seed, /jsonSchema:\s*\{\s*path: \['phase'\],\s*equals: 'reserved'/s);
});

test('seed enables Qwen3.5-Plus for result review and final evaluation', async () => {
  const source = await readFile(resolve(process.cwd(), '../../prisma/seed.cjs'), 'utf8');
  assert.match(source, /agentType: 'result_review'/);
  assert.match(source, /agentType: 'final_evaluation'/);
  assert.match(source, /provider: 'aliyun_bailian'/);
  assert.match(source, /modelName: 'qwen3\.5-plus'/);
  assert.match(source, /version: 'result-review-v2-qwen'/);
  assert.match(source, /version: 'final-evaluation-v2-qwen'/);
  assert.match(source, /maxTokens: 4000/);
  assert.match(source, /aiModelConfig\.updateMany/);
});
