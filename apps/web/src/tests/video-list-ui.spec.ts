import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('video list persists bounded filters and pagination in the URL', async () => {
  const page = await readFile(resolve(__dirname, '../../app/videos/page.tsx'), 'utf8');
  assert.match(page, /useSearchParams/);
  for (const field of ['search', 'status', 'platform', 'videoType', 'page']) assert.match(page, new RegExp(field));
  assert.match(page, /pageSize/);
  assert.match(page, /Asia\/Shanghai/);
  assert.match(page, /isTrial/);
});
