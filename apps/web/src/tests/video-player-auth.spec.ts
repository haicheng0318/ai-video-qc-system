import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('video fallback uses the cookie session without exposing a bearer token', async () => {
  const player = await readFile(resolve(__dirname, '../components/video-player.tsx'), 'utf8');
  assert.doesNotMatch(player, /getToken|Authorization|localStorage/);
  assert.match(player, /credentials:\s*'include'/);
});
