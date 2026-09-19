import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const entries = [
  ['release-browser-acceptance.mjs', 'RELEASE_BROWSER_BASE_URL'],
  ['v101-browser-acceptance.mjs', 'BROWSER_BASE_URL'],
  ['admin-operations-browser-acceptance.mjs', 'OPS_BROWSER_BASE_URL'],
  ['admin-settings-concurrency-browser.mjs', 'OPS_BROWSER_BASE_URL'],
];
// Deliberately unavailable PATH stops the real entry at its first child-process
// action. Rejected cases must fail at the guard, never at that boundary.
for (const [entry, key] of entries) {
  const run = env => spawnSync(process.execPath, [`apps/web/scripts/${entry}`], {
    cwd: root, env: { PATH: '/task5-no-executable-tools', ...env }, encoding: 'utf8', timeout: 5000,
  });
  test(`${entry}: no opt-in is rejected before any tool or browser action`, () => {
    const result = run({ [key]: 'http://127.0.0.1:3107' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /QC_LOCAL_REHEARSAL=1/);
    assert.doesNotMatch(result.stderr, /spawnSync which/);
  });
  test(`${entry}: production is rejected even with opt-in`, () => {
    const result = run({ QC_LOCAL_REHEARSAL: '1', NODE_ENV: 'production', [key]: 'http://127.0.0.1:3107' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /production mode is forbidden/);
    assert.doesNotMatch(result.stderr, /spawnSync which/);
  });
  test(`${entry}: remote, non-HTTP(S), credentials and malformed URLs are rejected`, () => {
    for (const url of ['https://remote.invalid', 'file://localhost/tmp', 'ftp://127.0.0.1',
      'http://fixture:password@127.0.0.1:3107', 'https://127.0.0.1.remote.invalid', 'not-a-url']) {
      const result = run({ QC_LOCAL_REHEARSAL: '1', [key]: url });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /local HTTP\(S\) URL without credentials/);
      assert.doesNotMatch(result.stderr, /spawnSync which/);
    }
  });
  test(`${entry}: opted-in local HTTP(S) reaches the first tool boundary`, () => {
    for (const url of ['http://127.0.0.1:3107', 'https://localhost:3107']) {
      const result = run({ QC_LOCAL_REHEARSAL: '1', [key]: url });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /spawnSync which ENOENT/);
      assert.doesNotMatch(result.stderr, /production mode is forbidden|requires QC_LOCAL_REHEARSAL/);
    }
  });
}

test('browser child environment drops inherited credentials, proxies and Node injection', async () => {
  const module = await import('../../../apps/web/scripts/local-browser-environment.mjs').catch(() => ({}));
  assert.equal(typeof module.localBrowserEnvironment, 'function');
  const result = module.localBrowserEnvironment({ QC_LOCAL_REHEARSAL: '1', PATH: '/local/bin', HOME: '/local/home',
    LANG: 'C.UTF-8', NODE_ENV: 'test', NODE_OPTIONS: '--require /unexpected.js',
    DATABASE_URL: 'private-database', DASHSCOPE_API_KEY: 'private-value', HTTPS_PROXY: 'https://remote.invalid',
    NEXT_PUBLIC_API_BASE_URL: 'https://remote.invalid', BROWSER_BASE_URL: 'http://127.0.0.1:3107' },
  'BROWSER_BASE_URL', 'http://127.0.0.1:3107');
  assert.equal(result.target.origin, 'http://127.0.0.1:3107');
  assert.deepEqual(result.childEnv, { PATH: '/local/bin', HOME: '/local/home', LANG: 'C.UTF-8',
    NODE_ENV: 'development', QC_LOCAL_REHEARSAL: '1', QC_SKIP_DOTENV: '1',
    NEXT_PUBLIC_API_BASE_URL: '', NEXT_PUBLIC_VIDEO_UPLOAD_MODE: 'multipart', NEXT_TELEMETRY_DISABLED: '1' });
});
