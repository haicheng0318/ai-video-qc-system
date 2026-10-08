import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const apiId = `sha256:${'a'.repeat(64)}`, webId = `sha256:${'b'.repeat(64)}`;
function compose(images = { API_IMAGE: apiId, WEB_IMAGE: webId }) {
  // config performs no Docker daemon operation and reads no actual dotenv file.
  return spawnSync('docker', ['compose', '--env-file', '/dev/null', '-f', 'deploy/lighthouse/compose.yaml',
    '--profile', 'maintenance', '--profile', 'bootstrap', 'config', '--format', 'json'], {
    cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, PUBLIC_HOST: 'local-fixture.invalid',
      POSTGRES_PASSWORD: 'fixture', JWT_SECRET: 'fixture', DEFAULT_ADMIN_PASSWORD: 'fixture', ...images }, encoding: 'utf8', timeout: 10000,
  });
}

test('release Compose consumes one explicit API image for all four roles and a separate Web image, with no implicit builds', () => {
  const result = compose(); assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  for (const service of ['api', 'worker', 'migrate', 'bootstrap']) {
    assert.equal(config.services[service].image, apiId, service);
    assert.equal(config.services[service].build, undefined, `${service} must not independently rebuild`);
    assert.equal(config.services[service].pull_policy, 'never', 'pre-registered artifacts only');
  }
  assert.equal(config.services.web.image, webId);
  assert.equal(config.services.web.build, undefined);
  assert.equal(config.services.web.pull_policy, 'never');
});

test('release Compose refuses missing API or Web candidate references', () => {
  for (const images of [{}, { API_IMAGE: apiId }, { WEB_IMAGE: webId }]) {
    const result = compose(images);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /API_IMAGE|WEB_IMAGE/);
  }
});

const contract = await import('../release-image-contract.mjs').catch(() => ({}));
test('candidate preflight refuses mutable references, divergent services and build instructions', () => {
  assert.equal(typeof contract.assertComposeImageContract, 'function');
  const config = JSON.parse(compose().stdout);
  const candidate = { apiImage: apiId, webImage: webId };
  assert.doesNotThrow(() => contract.assertComposeImageContract(config, candidate));
  for (const reference of ['', 'ai-video-qc-api:latest', 'ai-video-qc-api:v101', 'sha256:short', 'https://registry.invalid/image']) {
    assert.throws(() => contract.assertComposeImageContract(config, { ...candidate, apiImage: reference }));
  }
  for (const service of ['api', 'worker', 'migrate', 'bootstrap', 'web']) {
    const changed = structuredClone(config); changed.services[service].image = `sha256:${'c'.repeat(64)}`;
    assert.throws(() => contract.assertComposeImageContract(changed, candidate), service);
    const builds = structuredClone(config); builds.services[service].build = { context: '.' };
    assert.throws(() => contract.assertComposeImageContract(builds, candidate), service);
  }
  const digestConfig = structuredClone(config);
  const digestCandidate = { apiImage: `registry.invalid/qc/api@${apiId}`, webImage: `registry.invalid/qc/web@${webId}` };
  for (const role of ['api', 'worker', 'migrate', 'bootstrap']) digestConfig.services[role].image = digestCandidate.apiImage;
  digestConfig.services.web.image = digestCandidate.webImage;
  assert.doesNotThrow(() => contract.assertComposeImageContract(digestConfig, digestCandidate));
});

test('API start cannot run before a successful migration from the registered API image', () => {
  assert.equal(typeof contract.startVerifiedReleaseService, 'function');
  const migration = { Image: apiId, State: { Status: 'exited', ExitCode: 0, OOMKilled: false } };
  let starts = 0;
  const start = () => ++starts;
  for (const invalid of [null, { ...migration, Image: webId }, { ...migration, State: { Status: 'running', ExitCode: 0 } },
    { ...migration, State: { Status: 'exited', ExitCode: 1 } }, { ...migration, State: { Status: 'exited', ExitCode: 0, OOMKilled: true } }]) {
    assert.throws(() => contract.startVerifiedReleaseService('api', apiId, invalid, null, start));
  }
  assert.equal(starts, 0);
  assert.equal(contract.startVerifiedReleaseService('api', apiId, migration, null, start), 1);
});

test('worker start cannot run when the actual API image differs or API is stopped', () => {
  assert.equal(typeof contract.startVerifiedReleaseService, 'function');
  const migration = { Image: apiId, State: { Status: 'exited', ExitCode: 0 } };
  let starts = 0;
  for (const api of [null, { Image: webId, State: { Running: true } }, { Image: apiId, State: { Running: false } }]) {
    assert.throws(() => contract.startVerifiedReleaseService('worker', apiId, migration, api, () => ++starts));
  }
  assert.equal(starts, 0);
  assert.equal(contract.startVerifiedReleaseService('worker', apiId, migration, { Image: apiId, State: { Running: true } }, () => ++starts), 1);
  assert.throws(() => contract.startVerifiedReleaseService('unknown', apiId, migration, null, () => ++starts));
  assert.equal(starts, 1);
});
