import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('seed uses the phase 2 Gemini model and no reserved model placeholder', async () => {
  const seed = await readFile(resolve(process.cwd(), '../../prisma/seed.cjs'), 'utf8');
  assert.match(seed, /modelName: 'gemini-2\.5-flash'/);
  assert.doesNotMatch(seed, /reserved-gemini-video-model/);
  assert.doesNotMatch(seed, /Gemini content review schema will be added in phase 2/);
  assert.match(seed, /jsonSchema:\s*\{\s*path: \['phase'\],\s*equals: 'reserved'/s);
});
