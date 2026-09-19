import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This utility deliberately has no production mode and no destructive cleanup.
const container = 'ai-qc-task5-local';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const coreTables = ['users', 'videos', 'ai_content_reviews', 'content_review_scores', 'supervisor_reviews',
  'video_result_metrics', 'ai_result_reviews', 'rule_engine_results', 'final_video_evaluations',
  'operation_logs', 'ai_model_configs', 'platform_benchmarks'];

export function validateEnvironment(env, dockerEndpoint) {
  if (env.QC_LOCAL_REHEARSAL !== '1' || env.NODE_ENV === 'production') throw Error('Local rehearsal must be explicitly enabled; production is refused.');
  if (env.DOCKER_HOST || (env.DOCKER_CONTEXT && !['default', 'desktop-linux'].includes(env.DOCKER_CONTEXT))) throw Error('Docker environment overrides are refused.');
  if (!dockerEndpoint?.startsWith('unix:///')) throw Error('Only a local Unix-socket Docker daemon is allowed.');
}

export function assertLocalDatabaseUrl(value) {
  if (!value) throw Error('An explicit isolated database URL is required.');
  const url = new URL(value);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55441'
    || !/^\/(?:release_test|identity_test|queue_test|ops_test|v101_task5_[a-z0-9_]+)$/.test(url.pathname)
    || url.hash || [...url.searchParams].some(([key, val]) => key !== 'schema' || val !== 'public')) {
    throw Error('Only Task5 local test databases on 127.0.0.1:55441 are allowed.');
  }
  return url;
}

export function assertOwnedContainer(value) {
  const ports = value?.NetworkSettings?.Ports?.['5432/tcp'];
  if (value?.Name !== `/${container}` || value?.Config?.Labels?.['ai-video-qc.scope'] !== 'task5-local-only'
    || ports?.length !== 1 || ports[0].HostIp !== '127.0.0.1' || ports[0].HostPort !== '55441') {
    throw Error('Existing container is not the owned loopback-only Task5 fixture.');
  }
}

const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024, ...options });
function docker(...args) { return run('docker', args); }
function sql(database, statement) {
  assert.match(database, /^(?:release_test|identity_test|queue_test|ops_test|v101_task5_[a-z0-9_]+)$/);
  return run('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'release_admin', '-d', database, '-At'], { input: statement }).trim();
}

async function main() {
  // Validate the explicit opt-in before even contacting Docker.
  validateEnvironment(process.env, 'unix:///pending-local-inspection');
  validateEnvironment(process.env, docker('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}').trim());
  const mode = process.argv[2];
  if (!['rehearse', 'prepare-tests'].includes(mode)) throw Error('Usage: QC_LOCAL_REHEARSAL=1 node deploy/lighthouse/local-release.mjs rehearse|prepare-tests');
  let inspected;
  try { inspected = JSON.parse(docker('inspect', container))[0]; }
  catch {
    // --pull=never is intentional: this exercise must use an already available image.
    docker('run', '--pull=never', '-d', '--name', container, '--label', 'ai-video-qc.scope=task5-local-only',
      '-p', '127.0.0.1:55441:5432', '-e', 'POSTGRES_USER=release_admin', '-e', 'POSTGRES_PASSWORD=task5-local-only', 'postgres:16-alpine');
    inspected = JSON.parse(docker('inspect', container))[0];
  }
  assertOwnedContainer(inspected);
  for (let attempt = 0; attempt < 60; attempt++) {
    try { docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'release_admin'); break; }
    catch { if (attempt === 59) throw Error('Local fixture database did not become ready.'); await new Promise(r => setTimeout(r, 250)); }
  }
  const work = await mkdtemp(join(tmpdir(), 'ai-qc-task5-release-'));
  const schema = join(work, 'prisma/schema.prisma');
  await cp(join(root, 'prisma'), join(work, 'prisma'), { recursive: true });
  const safeEnv = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8', NODE_ENV: 'test', QC_SKIP_DOTENV: '1',
    CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' };
  const url = (database, role = 'release_admin') => `postgresql://${role}:task5-local-only@127.0.0.1:55441/${database}`;
  const prisma = (database, args, schemaPath = schema, role) => {
    const databaseUrl = url(database, role); assertLocalDatabaseUrl(databaseUrl);
    return run(process.execPath, [join(root, 'node_modules/prisma/build/index.js'), ...args, '--schema', schemaPath],
      { cwd: work, env: { ...safeEnv, DATABASE_URL: databaseUrl } });
  };
  const createDatabase = (name, owner = 'release_admin') => {
    assertLocalDatabaseUrl(url(name, owner));
    // CREATE without IF EXISTS fails on an existing target; no DROP/clean/overwrite fallback.
    docker('exec', container, 'createdb', '-U', 'release_admin', '-O', owner, name);
  };

  if (mode === 'prepare-tests') {
    const adminSql = statement => run('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'release_admin', '-d', 'postgres', '-At'], { input: statement }).trim();
    for (const name of ['release_test', 'identity_test', 'queue_test', 'ops_test']) {
      if (adminSql(`SELECT count(*) FROM pg_database WHERE datname='${name}';`) !== '0') throw Error(`Refusing existing ${name}; prepared fixtures are retained for reruns, never reset automatically.`);
    }
    for (const name of ['release_test', 'identity_test', 'queue_test', 'ops_test']) {
      if (adminSql(`SELECT count(*) FROM pg_roles WHERE rolname='${name}';`) === '0') adminSql(`CREATE ROLE ${name} LOGIN PASSWORD 'task5-local-only';`);
      createDatabase(name, name);
      prisma(name, ['migrate', 'deploy'], schema, name);
    }
    console.log(JSON.stringify({ ok: true, container, databases: ['release_test', 'identity_test', 'queue_test', 'ops_test'], port: 55441, workDirectory: work }));
    return;
  }

  const stamp = Date.now().toString(36);
  const names = { empty: `v101_task5_empty_${stamp}`, legacy: `v101_task5_legacy_${stamp}`,
    restore: `v101_task5_restore_${stamp}`, forward: `v101_task5_forward_${stamp}` };
  const evidence = join(root, '.superpowers/sdd/2026-09-07-v101-continuous/task5-release', stamp);
  await mkdir(evidence, { recursive: true });
  const logs = [];
  for (const name of [names.empty, names.legacy]) createDatabase(name);
  logs.push(prisma(names.empty, ['migrate', 'deploy']));
  const legacyDir = join(work, 'legacy');
  await mkdir(join(legacyDir, 'migrations'), { recursive: true });
  await cp(schema, join(legacyDir, 'schema.prisma'));
  await cp(join(work, 'prisma/migrations/migration_lock.toml'), join(legacyDir, 'migrations/migration_lock.toml'));
  const migrations = (await readdir(join(work, 'prisma/migrations'))).filter(name => /^\d/.test(name)).sort();
  for (const name of migrations.filter(name => name < '202609')) await cp(join(work, 'prisma/migrations', name), join(legacyDir, 'migrations', name), { recursive: true });
  logs.push(prisma(names.legacy, ['migrate', 'deploy'], join(legacyDir, 'schema.prisma')));
  sql(names.legacy, await readFile(join(root, 'deploy/lighthouse/fixtures/representative-v100.sql'), 'utf8'));

  const columns = Object.fromEntries(coreTables.map(table => [table, sql(names.legacy,
    `SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}';`)]));
  const fingerprints = database => Object.fromEntries(coreTables.map(table => [table, sql(database,
    `SELECT count(*) || ':' || md5(coalesce(string_agg(row_to_json(t)::text, E'\\n' ORDER BY id),'')) FROM (SELECT ${columns[table]} FROM ${table}) t;`)]));
  const before = fingerprints(names.legacy);
  for (const table of coreTables) assert.ok(!before[table].startsWith('0:'), `${table}: representative data required`);

  const backup = async (database, label) => {
    const remotePath = `/tmp/task5-${stamp}-${label}.dump`;
    docker('exec', container, 'pg_dump', '-U', 'release_admin', '-Fc', '--no-owner', '--no-privileges', '-d', database, '-f', remotePath);
    const localPath = join(evidence, `${label}.dump`);
    docker('cp', `${container}:${remotePath}`, localPath);
    const bytes = await readFile(localPath);
    return { remotePath, file: localPath, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  const restore = (database, saved) => {
    createDatabase(database);
    docker('exec', container, 'pg_restore', '-U', 'release_admin', '--no-owner', '--no-privileges', '--exit-on-error', '-d', database, saved.remotePath);
  };
  const pre = await backup(names.legacy, 'pre-upgrade');
  logs.push(prisma(names.legacy, ['migrate', 'deploy']));
  assert.deepEqual(fingerprints(names.legacy), before, 'upgrade changed representative existing rows');
  assert.equal(sql(names.legacy, 'SELECT count(*) FROM videos WHERE is_trial;'), '0');
  assert.equal(sql(names.legacy, 'SELECT count(*) FROM user_sessions;'), '0');
  restore(names.restore, pre);
  assert.deepEqual(fingerprints(names.restore), before, 'pre-upgrade backup restore changed data');
  logs.push(prisma(names.restore, ['migrate', 'deploy']));
  assert.deepEqual(fingerprints(names.restore), before, 'restored legacy database cannot roll forward');

  // A post-cutover write must survive the forward recovery, not disappear into an older backup.
  sql(names.legacy, `INSERT INTO operation_logs (id, action_type, comment) VALUES (gen_random_uuid(), 'task5_post_cutover', 'synthetic post-cutover audit');`);
  const after = fingerprints(names.legacy);
  const post = await backup(names.legacy, 'post-cutover');
  restore(names.forward, post);
  logs.push(prisma(names.forward, ['migrate', 'deploy']));
  assert.deepEqual(fingerprints(names.forward), after, 'forward recovery lost post-cutover data');
  assert.equal(sql(names.forward, "SELECT count(*) FROM operation_logs WHERE action_type='task5_post_cutover';"), '1');
  for (const name of Object.values(names)) {
    assert.equal(Number(sql(name, 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;')), migrations.length);
    const result = run(process.execPath, [join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-url', url(name), '--to-schema-datamodel', schema, '--exit-code'], { cwd: work, env: safeEnv });
    logs.push(result);
  }
  const summary = { ok: true, scope: 'local PostgreSQL 16; synthetic rows only; no production/cloud/model calls',
    databaseServer: sql(names.legacy, 'SELECT version();'), databases: names, migrations: migrations.length,
    before, after, backups: [pre, post], coreTablesPreserved: 12, schemaDrift: false,
    rollback: 'restore into NEW database, retain current schema, roll forward; post-cutover audit preserved',
    retainedContainer: container, workDirectory: work };
  await writeFile(join(evidence, 'summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(join(evidence, 'migrations.log'), logs.join('\n'));
  console.log(JSON.stringify({ ...summary, evidence }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
