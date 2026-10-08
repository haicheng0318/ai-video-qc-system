import assert from 'node:assert/strict';
import { test } from 'node:test';

test('acceptance refuses project/remote databases and inherited provider credentials', async () => {
  const path = '../test-support/local-acceptance';
  const guards = await import(path).catch(() => ({}));
  assert.equal(typeof guards.assertIsolatedDatabase, 'function');
  for (const url of ['', 'postgresql://test:test@server:55441/release_test',
    'postgresql://test:test@127.0.0.1:5432/ai_video_qc',
    'postgresql://test:test@127.0.0.1:55441/release_test?host=remote',
    'postgresql://test:test@127.0.0.1:55441/release_test?schema=production']) {
    assert.throws(() => guards.assertIsolatedDatabase(url));
  }
  assert.doesNotThrow(() => guards.assertIsolatedDatabase('postgresql://release_test:local@127.0.0.1:55441/release_test'));
  const env = { QC_LOCAL_ACCEPTANCE: '1', DASHSCOPE_API_KEY: 'inherited-secret', TENCENTCLOUD_SECRET_KEY: 'inherited-secret' };
  guards.configureLocalAcceptance('postgresql://release_test:local@127.0.0.1:55441/release_test', env);
  assert.equal(env.DASHSCOPE_API_KEY, ''); assert.equal(env.TENCENTCLOUD_SECRET_KEY, '');
  assert.throws(() => guards.configureLocalAcceptance('postgresql://release_test:local@127.0.0.1:55441/release_test', {}));
});
