import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEnvironment, assertOwnedContainer } from './local-release.mjs';
import { assertComposeImageContract, startVerifiedReleaseService } from './release-image-contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const network = 'ai-qc-task5-isolated';
export function assertOwnedNetwork(value) {
  if (value?.Name !== network || value?.Internal !== true || value?.Labels?.['ai-video-qc.scope'] !== 'task5-local-only') {
    throw Error('Only the explicitly labelled, internal Task5 Docker network is allowed.');
  }
}

async function main() {
  validateEnvironment(process.env, 'unix:///pending-local-inspection');
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, QC_SKIP_DOTENV: '1', QC_LOCAL_REHEARSAL: '1', NEXT_TELEMETRY_DISABLED: '1',
    BROWSER_BASE_URL: 'http://127.0.0.1:3107', RELEASE_BROWSER_BASE_URL: 'http://127.0.0.1:3107', OPS_BROWSER_BASE_URL: 'http://127.0.0.1:3107' };
  const docker = (...args) => execFileSync('docker', args, { cwd: root, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();
  validateEnvironment(process.env, docker('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'));
  const pg = JSON.parse(docker('inspect', 'ai-qc-task5-local'))[0]; assertOwnedContainer(pg);
  let fixtureNetwork;
  const networkIds = docker('network', 'ls', '--filter', `name=^${network}$`, '--format', '{{.ID}}');
  if (!networkIds) docker('network', 'create', '--internal', '--label', 'ai-video-qc.scope=task5-local-only', network);
  fixtureNetwork = JSON.parse(docker('network', 'inspect', network))[0]; assertOwnedNetwork(fixtureNetwork);
  if (!pg.NetworkSettings.Networks[network]) docker('network', 'connect', network, 'ai-qc-task5-local');

  const stamp = Date.now().toString(36), database = `v101_task5_image_${stamp}`;
  env.QC_BROWSER_RUN_ID = stamp;
  const output = join(root, '.superpowers/sdd/2026-09-07-v101-continuous/task5-images', stamp);
  await mkdir(output, { recursive: true });
  const results = [], containers = [];
  async function command(name, executable, args) {
    let content = ''; const started = Date.now();
    const child = spawn(executable, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', value => { content += value; }); child.stderr.on('data', value => { content += value; });
    const code = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', done); });
    await writeFile(join(output, `${name}.log`), content);
    const result = { name, exitCode: code, elapsedMs: Date.now() - started }; results.push(result); console.log(JSON.stringify(result));
    if (code !== 0) throw Error(`${name} failed; see retained log.`);
  }
  const apiImage = `ai-video-qc-api:task5-${stamp}`, webImage = `ai-video-qc-web:task5-${stamp}`;
  // No host secrets or dotenv files are passed to Docker builds or child commands.
  const apiEnv = ['-e', 'NODE_ENV=production', '-e', 'QC_SKIP_DOTENV=1', '-e', 'PORT=8080', '-e', 'API_HOST=0.0.0.0',
    '-e', 'WEB_ORIGIN=https://local-fixture.invalid', '-e', 'JWT_SECRET=task5-local-fixture-secret-at-least-32-characters',
    '-e', `DATABASE_URL=postgresql://release_admin:task5-local-only@ai-qc-task5-local:5432/${database}`, '-e', 'VIDEO_STORAGE_PROVIDER=local'];
  const create = (kind, image, additional = [], commandArgs = [], networkName = network) => {
    const name = `ai-qc-task5-${kind}-${stamp}`;
    docker('run', '--pull=never', '-d', '--name', name, '--label', 'ai-video-qc.scope=task5-local-only', '--network', networkName, ...additional, image, ...commandArgs);
    containers.push(name); return name;
  };
  try {
    await command('api-image-build', 'docker', ['build', '--pull=false', '--build-arg', 'NPM_CONFIG_REGISTRY=https://registry.npmjs.org', '-f', 'Dockerfile.api', '-t', apiImage, '.']);
    await command('web-image-build', 'docker', ['build', '--pull=false', '--build-arg', 'NPM_CONFIG_REGISTRY=https://registry.npmjs.org', '--build-arg', 'NEXT_PUBLIC_API_BASE_URL=', '--build-arg', 'NEXT_PUBLIC_VIDEO_UPLOAD_MODE=multipart', '-f', 'Dockerfile.web', '-t', webImage, '.']);
    const candidate = { apiImage: JSON.parse(docker('image', 'inspect', apiImage))[0].Id,
      webImage: JSON.parse(docker('image', 'inspect', webImage))[0].Id };
    // Register immutable IDs before any migration/start. The deployment template,
    // not independently named service builds, determines all consumed images.
    env.API_IMAGE = candidate.apiImage; env.WEB_IMAGE = candidate.webImage;
    const config = JSON.parse(docker('compose', '--env-file', 'deploy/lighthouse/.env.example', '-f', 'deploy/lighthouse/compose.yaml',
      '--profile', 'maintenance', '--profile', 'bootstrap', 'config', '--format', 'json'));
    assertComposeImageContract(config, candidate);
    await writeFile(join(output, 'release-candidate.json'), JSON.stringify({ localOnly: true, ...candidate,
      serviceImages: Object.fromEntries(['api', 'worker', 'migrate', 'bootstrap', 'web'].map(name => [name, config.services[name].image])),
      implicitBuilds: false, implicitPulls: false }, null, 2));
    docker('exec', 'ai-qc-task5-local', 'createdb', '-U', 'release_admin', database);
    await command('image-migration', 'docker', ['run', '--pull=never', '--name', `ai-qc-task5-migrate-${stamp}`, '--label', 'ai-video-qc.scope=task5-local-only', '--network', network,
      ...apiEnv, config.services.migrate.image, 'node', '/app/node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', '/app/prisma/schema.prisma']);
    const migration = JSON.parse(docker('inspect', `ai-qc-task5-migrate-${stamp}`))[0];
    const api = startVerifiedReleaseService('api', candidate.apiImage, migration, null,
      () => create('api', config.services.api.image, apiEnv));
    const apiStarted = JSON.parse(docker('inspect', api))[0];
    const worker = startVerifiedReleaseService('worker', candidate.apiImage, migration, apiStarted,
      () => create('worker', config.services.worker.image, apiEnv, ['node', 'dist/worker.js']));
    const web = create('web', config.services.web.image);
    await writeFile(join(output, 'startup-image-checks.json'), JSON.stringify({ expectedApiImage: candidate.apiImage,
      migrationImage: migration.Image, migrationExitCode: migration.State.ExitCode, apiImageBeforeWorkerStart: apiStarted.Image,
      workerImage: JSON.parse(docker('inspect', worker))[0].Image, checkedBeforeApiStart: true, checkedBeforeWorkerStart: true }, null, 2));
    // Docker Desktop does not publish ports from an internal-only network.
    // This credential-free relay has two FIXED local targets; only it joins the
    // normal bridge. Application/worker containers keep no outbound route.
    const relayCode = `const http=require('node:http');for(const [port,host] of [[3141,${JSON.stringify(api)}],[3107,${JSON.stringify(web)}]])http.createServer((req,res)=>{const next=http.request({hostname:host,port:8080,path:req.url,method:req.method,headers:req.headers},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res)});next.on('error',()=>{res.writeHead(503);res.end('Local fixture not ready')});req.pipe(next)}).listen(port,'0.0.0.0');`;
    const relay = create('relay', 'node:22.13-alpine', ['-p', '127.0.0.1:3141:3141', '-p', '127.0.0.1:3107:3107'], ['node', '-e', relayCode], 'bridge');
    docker('network', 'connect', network, relay);
    const statuses = {};
    for (const [name, url] of [['api', 'http://127.0.0.1:3141/api/health/ready'], ['web', 'http://127.0.0.1:3107/login']]) {
      let ready = false;
      for (let attempt = 0; attempt < 80; attempt++) {
        try { const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(1000) }); if (response.status === 200) { ready = true; statuses[name] = response.status; break; } } catch {}
        await new Promise(done => setTimeout(done, 250));
      }
      assert.equal(ready, true, `${name} did not become locally ready`);
    }
    const query = statement => docker('exec', 'ai-qc-task5-local', 'psql', '-X', '-U', 'release_admin', '-d', database, '-Atc', statement);
    assert.equal(query('SELECT count(*) FROM users'), '0', 'starting the image must not seed accounts');
    assert.equal(query('SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL'), '12');
    assert.equal(JSON.parse(docker('inspect', worker))[0].State.Running, true);
    for (let attempt = 0; attempt < 40 && query('SELECT count(*) FROM worker_heartbeats') === '0'; attempt++) await new Promise(done => setTimeout(done, 250));
    assert.equal(query("SELECT count(*) FROM worker_heartbeats WHERE last_seen_at > now() - interval '30 seconds'"), '1', 'independent worker must persist a fresh heartbeat');
    await command('workflow-browser', process.execPath, ['apps/web/scripts/v101-browser-acceptance.mjs']);
    await command('operations-browser', process.execPath, ['apps/web/scripts/admin-operations-browser-acceptance.mjs']);
    await command('settings-concurrency-browser', process.execPath, ['apps/web/scripts/admin-settings-concurrency-browser.mjs']);
    await command('release-browser', process.execPath, ['apps/web/scripts/release-browser-acceptance.mjs']);
    await command('web-security-http', process.execPath, ['apps/web/scripts/local-security-acceptance.mjs']);
    for (const name of [api, worker, web, relay]) await writeFile(join(output, `${name}.log`), docker('logs', name));
    await writeFile(join(output, 'runtime.json'), JSON.stringify({ statuses, database, accounts: 0,
      apiImage: JSON.parse(docker('image', 'inspect', apiImage))[0].Id, webImage: JSON.parse(docker('image', 'inspect', webImage))[0].Id,
      network: 'internal, labelled local-only; application containers have no outbound route', workerRunning: true, workerHeartbeatPersisted: true }, null, 2));
  } finally {
    // Stop only containers created by this invocation; retain all images/data/logs.
    for (const name of containers) {
      const inspected = JSON.parse(docker('inspect', name))[0];
      if (inspected.Config.Labels?.['ai-video-qc.scope'] !== 'task5-local-only' || !name.endsWith(`-${stamp}`)) throw Error('Refusing unexpected container cleanup target.');
      await writeFile(join(output, `${name}.log`), docker('logs', name));
      docker('stop', '--time', '8', name);
    }
    await writeFile(join(output, 'summary.json'), JSON.stringify({ localOnly: true, results, retainedContainers: containers, retainedDatabase: database }, null, 2));
    console.log(`Evidence: ${output}`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
