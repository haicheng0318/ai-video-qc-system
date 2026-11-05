import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';

function entry(overrides: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, QC_SKIP_DOTENV: '1', ...overrides };
  delete env.NODE_TEST_CONTEXT;
  for (const key of ['V11_DIAGNOSTICS_TEST_DATABASE_URL', 'V11_DIAGNOSTICS_ACCEPTANCE_REQUIRED', 'RELEASE_ACCEPTANCE_REQUIRED', 'RELEASE_TEST_DATABASE_URL']) {
    if (!(key in overrides)) delete env[key];
  }
  return spawnSync(process.execPath, ['--import', 'tsx', '--test', resolve(__dirname, 'v11-diagnostics-http.integration.spec.ts')], { env, encoding: 'utf8', timeout: 20_000 });
}
test('ordinary test entry may skip diagnostics without a database', () => {
  const result = entry(); assert.equal(result.status, 0); assert.match(result.stdout, /skipped 1|SKIP/);
});
for (const flag of ['V11_DIAGNOSTICS_ACCEPTANCE_REQUIRED', 'RELEASE_ACCEPTANCE_REQUIRED']) {
  test(`${flag} refuses missing database instead of skipping`, () => {
    const result = entry({ [flag]: '1' }); assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /V11_DIAGNOSTICS_TEST_DATABASE_URL is required/);
  });
}
test('diagnostics entry refuses a nonisolated target before connecting', () => {
  const result = entry({ V11_DIAGNOSTICS_TEST_DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/ai_video_qc' });
  assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /Acceptance refuses/);
});
test('release and diagnostics databases must be distinct', () => {
  const url = 'postgresql://fixture:fixture@127.0.0.1:55443/release_test';
  const result = entry({ RELEASE_ACCEPTANCE_REQUIRED: '1', RELEASE_TEST_DATABASE_URL: url, V11_DIAGNOSTICS_TEST_DATABASE_URL: url });
  assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /separate disposable database/);
});
