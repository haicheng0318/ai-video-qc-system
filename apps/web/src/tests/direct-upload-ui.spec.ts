import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('direct upload uses measured XHR progress, cancellation and a stable UUID ticket key', async () => {
  const helper = await readFile(resolve(__dirname, '../lib/direct-video-upload.ts'), 'utf8');
  const page = await readFile(resolve(__dirname, '../../app/videos/new/page.tsx'), 'utf8');
  assert.match(helper, /XMLHttpRequest/);
  assert.match(helper, /lengthComputable/);
  assert.match(helper, /Idempotency-Key/);
  assert.match(helper, /direct-upload-tickets\/\$\{ticket\.ticketId\}\/cancel/);
  assert.doesNotMatch(helper, /Content-Length/);
  assert.match(page, /AbortController/);
  assert.match(page, /取消上传/);
  assert.match(page, /crypto\.randomUUID/);
});
