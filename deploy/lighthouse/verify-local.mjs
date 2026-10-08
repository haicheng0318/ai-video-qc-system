import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { validateEnvironment, assertOwnedContainer } from './local-release.mjs';

// Repeatable local verification, with no inherited model/cloud credentials.
validateEnvironment(process.env, 'unix:///pending-local-inspection');
validateEnvironment(process.env, execFileSync('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { encoding: 'utf8' }).trim());
assertOwnedContainer(JSON.parse(execFileSync('docker', ['inspect', 'ai-qc-task5-local'], { encoding: 'utf8' }))[0]);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = join(root, '.superpowers/sdd/2026-09-07-v101-continuous/task5-verification', Date.now().toString(36));
await mkdir(output, { recursive: true });
const env = { PATH: process.env.PATH, HOME: process.env.HOME, QC_SKIP_DOTENV: '1', QC_LOCAL_ACCEPTANCE: '1',
  NODE_ENV: 'test', JWT_SECRET: 'local-test-only-secret-at-least-32-characters',
  NEXT_PUBLIC_API_BASE_URL: '', NEXT_PUBLIC_VIDEO_UPLOAD_MODE: 'multipart', NEXT_TELEMETRY_DISABLED: '1',
  DATABASE_URL: 'postgresql://release_test:task5-local-only@127.0.0.1:55441/release_test',
  RELEASE_TEST_DATABASE_URL: 'postgresql://release_test:task5-local-only@127.0.0.1:55441/release_test',
  HTTP_ACCEPTANCE_DATABASE_URL: 'postgresql://release_test:task5-local-only@127.0.0.1:55441/release_test',
  IDENTITY_TEST_DATABASE_URL: 'postgresql://identity_test:task5-local-only@127.0.0.1:55441/identity_test',
  EVALUATION_JOBS_TEST_DATABASE_URL: 'postgresql://queue_test:task5-local-only@127.0.0.1:55441/queue_test',
  OPS_TEST_DATABASE_URL: 'postgresql://ops_test:task5-local-only@127.0.0.1:55441/ops_test' };
const results = [];
async function check(name, command, args, options = {}) {
  const started = Date.now(); let outputText = '';
  const child = spawn(command, args, { cwd: root, env: { ...env, ...options.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { outputText += data; }); child.stderr.on('data', data => { outputText += data; });
  const code = await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('exit', resolveExit); });
  const log = join(output, `${name}.log`); await writeFile(log, outputText);
  const summary = { name, command: [command, ...args].join(' '), exitCode: code, elapsedMs: Date.now() - started, log,
    counts: outputText.split('\n').filter(line => /^# (tests|pass|fail|skipped) /.test(line)) };
  results.push(summary); console.log(JSON.stringify(summary));
  if (code !== 0 && !options.allowFailure) {
    console.error(outputText.split('\n').filter((line, index, lines) => line.includes('not ok') || lines.slice(Math.max(0, index - 8), index).some(prior => prior.includes('not ok'))).join('\n'));
    throw Error(`${name} failed; see retained log.`);
  }
}
try {
  await check('release-safety', process.execPath, ['--test', 'deploy/lighthouse/tests/local-release.spec.mjs', 'deploy/lighthouse/tests/startup.spec.mjs',
    'deploy/lighthouse/tests/browser-entrypoints.spec.mjs', 'deploy/lighthouse/tests/release-images.spec.mjs']);
  await check('api-build', 'npm', ['--workspace', '@ai-video-qc/api', 'run', 'build']);
  for (const stage of ['result-review', 'rule-engine', 'final-evaluation', 'phase-8']) {
    await check(`legacy-http-${stage}`, process.execPath, [`apps/api/dist/scripts/${stage}-http-acceptance.js`]);
  }
  await check('all-tests', 'npm', ['test']);
  await check('typecheck', 'npm', ['run', 'typecheck']);
  await check('build', 'npm', ['run', 'build'], { env: { NODE_ENV: 'production' } });
  await check('diff-check', 'git', ['diff', '--check']);
  await check('dependency-audit', 'npm', ['audit', '--omit=dev', '--json'], { allowFailure: true });
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await writeFile(join(output, 'summary.json'), JSON.stringify({ results, localOnly: true }, null, 2)); console.log(`Evidence: ${output}`); }
