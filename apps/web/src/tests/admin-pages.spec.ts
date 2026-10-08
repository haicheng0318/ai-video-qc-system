import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('account management uses typed list and create interfaces without a JSON textarea', async () => {
  const page = await readFile(resolve(__dirname, '../../app/admin/users/page.tsx'), 'utf8');
  const form = await readFile(resolve(__dirname, '../components/admin/user-create-form.tsx'), 'utf8');
  assert.match(page, /\/api\/admin\/users/);
  assert.match(form, /\/api\/admin\/users/);
  assert.match(form, /initialPassword/);
  assert.doesNotMatch(form, /<textarea[^>]*>[\s\S]*JSON/i);
});

test('role matrix is driven by the backend role capability endpoint', async () => {
  const page = await readFile(resolve(__dirname, '../../app/admin/roles/page.tsx'), 'utf8');
  assert.match(page, /\/api\/admin\/roles/);
  assert.match(page, /capabilities/);
});

test('account detail exposes guarded session and quota operations with stable business keys', async () => {
  const page = await readFile(resolve(__dirname, '../../app/admin/users/[id]/page.tsx'), 'utf8');
  const quota = await readFile(resolve(__dirname, '../components/admin/quota-adjustment-form.tsx'), 'utf8');
  assert.match(page, /\/sessions/);
  assert.match(page, /\/quotas/);
  assert.match(page, /reset-password|revoke-sessions/);
  assert.match(quota, /businessKey/);
  assert.match(quota, /crypto\.randomUUID/);
  assert.match(quota, /storage_bytes/);
  assert.match(quota, /lifetime/);
});
