import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('admin login uses the shared cookie endpoint with the admin-only flag', async () => {
  const page = await readFile(resolve(__dirname, '../../app/admin/login/page.tsx'), 'utf8');
  const form = await readFile(resolve(__dirname, '../components/login-form.tsx'), 'utf8');
  assert.match(page, /adminOnly/);
  assert.match(form, /\/api\/auth\/login/);
  assert.match(form, /adminOnly/);
  assert.doesNotMatch(form, /accessToken|localStorage|Authorization/);
});

test('first login password change uses the protected change-password endpoint', async () => {
  const page = await readFile(resolve(__dirname, '../../app/change-password/page.tsx'), 'utf8');
  assert.match(page, /\/api\/auth\/change-password/);
  assert.match(page, /current-password/);
  assert.match(page, /new-password/);
  assert.match(page, /12/);
});

test('authentication routes render without the business navigation shell', async () => {
  const shell = await readFile(resolve(__dirname, '../components/app-shell.tsx'), 'utf8');
  const layout = await readFile(resolve(__dirname, '../../app/layout.tsx'), 'utf8');
  assert.match(shell, /\/admin\/login/);
  assert.match(shell, /\/login/);
  assert.match(layout, /<AppShell>/);
});

test('application shell derives visitor quotas and admin navigation from the authenticated user', async () => {
  const shell = await readFile(resolve(__dirname, '../components/app-shell.tsx'), 'utf8');
  assert.match(shell, /\/api\/auth\/me/);
  assert.match(shell, /\/api\/auth\/quotas/);
  assert.match(shell, /visitor/);
  assert.match(shell, /user\?\.role === 'admin'/);
});
