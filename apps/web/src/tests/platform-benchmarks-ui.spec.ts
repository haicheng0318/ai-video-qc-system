import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('platform benchmark page exposes create, edit, thresholds and role guidance', async () => {
  const source = await readFile(
    new URL('../../app/settings/benchmarks/page.tsx', import.meta.url),
    'utf8',
  );
  for (const text of ['平台基准配置', '新增基准', '编辑基准', 'S 阈值', 'A 阈值', 'B 阈值', 'C 阈值']) {
    assert.match(source, new RegExp(text));
  }
  assert.match(source, /admin/);
  assert.match(source, /content_owner/);
  assert.match(source, /apiFetch<\{ user: ApiUser \}>\('\/api\/auth\/me'\)/);
  assert.match(source, /setUser\(me\.user\)/);
  assert.match(source, /\/api\/platform-benchmarks/);
  assert.doesNotMatch(source, /method:\s*['"]DELETE['"]/);
});

test('application navigation links to platform benchmark management', async () => {
  const source = await readFile(new URL('../components/app-shell.tsx', import.meta.url), 'utf8');
  assert.match(source, /settings\/benchmarks/);
  assert.match(source, /基准配置/);
});
