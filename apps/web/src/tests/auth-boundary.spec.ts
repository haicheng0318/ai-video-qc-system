import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('protected application shell verifies the cookie session before rendering business pages', async () => {
  const boundary = await readFile(resolve(__dirname, '../components/auth-boundary.tsx'), 'utf8');
  const layout = await readFile(resolve(__dirname, '../../app/layout.tsx'), 'utf8');
  assert.doesNotMatch(boundary, /getToken|localStorage|Authorization/);
  assert.match(boundary, /\/api\/auth\/me/);
  assert.match(boundary, /router\.replace\('\/login'\)/);
  assert.match(layout, /<AuthBoundary>/);
});
