import assert from 'node:assert/strict';
import { test } from 'node:test';

const release = await import('../local-release.mjs').catch(() => ({}));

test('rehearsal refuses missing consent, production mode and remote Docker daemons before any operation', () => {
  assert.equal(typeof release.validateEnvironment, 'function');
  for (const env of [{}, { QC_LOCAL_REHEARSAL: '1', NODE_ENV: 'production' },
    { QC_LOCAL_REHEARSAL: '1', DOCKER_HOST: 'tcp://10.1.1.1:2375' },
    { QC_LOCAL_REHEARSAL: '1', DOCKER_CONTEXT: 'production' }]) {
    assert.throws(() => release.validateEnvironment(env, 'unix:///var/run/docker.sock'));
  }
  assert.throws(() => release.validateEnvironment({ QC_LOCAL_REHEARSAL: '1' }, 'ssh://remote.example'));
  assert.doesNotThrow(() => release.validateEnvironment({ QC_LOCAL_REHEARSAL: '1' }, 'unix:///var/run/docker.sock'));
});

test('rehearsal database guard rejects nonlocal, project, URL-option and malformed targets', () => {
  assert.equal(typeof release.assertLocalDatabaseUrl, 'function');
  for (const url of [undefined, '', 'postgresql://x:y@db.example:55441/release_test',
    'postgresql://x:y@127.0.0.1:5432/ai_video_qc', 'postgresql://x:y@127.0.0.1:55441/production',
    'postgresql://x:y@localhost:55441/release_test', 'postgresql://x:y@127.0.0.1:55441/release_test?host=remote',
    'postgresql://x:y@127.0.0.1:55441/release_test#bad']) {
    assert.throws(() => release.assertLocalDatabaseUrl(url));
  }
  assert.doesNotThrow(() => release.assertLocalDatabaseUrl('postgresql://release_test:local@127.0.0.1:55441/release_test'));
});

test('rehearsal never adopts an unlabelled or broadly exposed existing container', () => {
  assert.equal(typeof release.assertOwnedContainer, 'function');
  const owned = { Name: '/ai-qc-task5-local', Config: { Labels: { 'ai-video-qc.scope': 'task5-local-only' } },
    NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '55441' }] } } };
  assert.doesNotThrow(() => release.assertOwnedContainer(owned));
  assert.throws(() => release.assertOwnedContainer({ ...owned, Name: '/ai-video-qc-postgres' }));
  assert.throws(() => release.assertOwnedContainer({ ...owned, Config: { Labels: {} } }));
  assert.throws(() => release.assertOwnedContainer({ ...owned, NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '55441' }] } } }));
});

test('image smoke fixture requires an owned internal Docker network', async () => {
  const smoke = await import('../local-image-smoke.mjs').catch(() => ({}));
  assert.equal(typeof smoke.assertOwnedNetwork, 'function');
  const owned = { Name: 'ai-qc-task5-isolated', Internal: true, Labels: { 'ai-video-qc.scope': 'task5-local-only' } };
  assert.doesNotThrow(() => smoke.assertOwnedNetwork(owned));
  for (const changed of [{ Name: 'production' }, { Internal: false }, { Labels: {} }]) {
    assert.throws(() => smoke.assertOwnedNetwork({ ...owned, ...changed }));
  }
});

test('source audit never copies dotenv secrets, storage, evidence, archives or outside paths', async () => {
  const audit = await import('../local-source-audit.mjs').catch(() => ({}));
  assert.equal(typeof audit.isScanPath, 'function');
  for (const path of ['.env', 'apps/api/.env.production', 'deploy/lighthouse/.env', '.superpowers/note.md', 'apps/web/.superpowers/a.json',
    'storage/videos/private.mp4', 'docs/archive.zip', '../package.json', '/etc/passwd', 'node_modules/a.js']) assert.equal(audit.isScanPath(path), false, path);
  for (const path of ['apps/api/src/main.ts', 'deploy/lighthouse/README.md', 'Dockerfile.api', 'package-lock.json', 'prisma/schema.prisma']) assert.equal(audit.isScanPath(path), true, path);
});

test('browser evidence is scoped to a new local run rather than replacing earlier task evidence', async () => {
  const output = await import('../../../apps/web/scripts/local-browser-output.mjs').catch(() => ({}));
  assert.equal(typeof output.browserOutput, 'function');
  assert.match(output.browserOutput('release', 'test123'), /task5-browser\/test123\/release$/);
  for (const run of ['../old', '/tmp', '']) assert.throws(() => output.browserOutput('release', run));
  assert.throws(() => output.browserOutput('../source', 'test123'));
});
