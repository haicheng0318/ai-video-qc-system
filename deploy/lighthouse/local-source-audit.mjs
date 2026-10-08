import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEnvironment } from './local-release.mjs';

export function isScanPath(path) {
  if (!path || path.startsWith('/') || path.split('/').some(part => part === '..' || part === '.' || part === '.superpowers'
    || part === 'node_modules' || part === '.next' || part === 'dist' || part === 'storage' || part === 'output' || part.startsWith('.env'))) return false;
  return /\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|sql|prisma|yaml|yml|toml|sh|css)$/.test(path) || /^Dockerfile(?:\.|$)/.test(basename(path)) || basename(path) === '.dockerignore';
}
async function main() {
  validateEnvironment(process.env, 'unix:///pending-local-inspection');
  const env = { PATH: process.env.PATH, HOME: process.env.HOME };
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const run = (executable, args) => execFileSync(executable, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  validateEnvironment(process.env, run('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).trim());
  const temporary = await mkdtemp(join(tmpdir(), 'ai-qc-task5-source-'));
  const stamp = Date.now().toString(36), evidence = join(root, '.superpowers/sdd/2026-09-07-v101-continuous/task5-security', stamp);
  await mkdir(evidence, { recursive: true });
  const manifest = [];
  const paths = [...new Set(run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(isScanPath))].sort();
  for (const path of paths) {
    const source = join(root, path); let stat;
    try { stat = await lstat(source); } catch { continue; }
    if (!stat.isFile()) continue; // Never follow a symlink to secrets or another tree.
    const target = join(temporary, 'source', path); await mkdir(dirname(target), { recursive: true }); await copyFile(source, target);
    manifest.push({ path, bytes: stat.size, sha256: createHash('sha256').update(await readFile(source)).digest('hex') });
  }
  let browserChunks = 0;
  async function copyChunks(directory, relative = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const nested = join(relative, entry.name), source = join(directory, entry.name);
      if (entry.isDirectory()) await copyChunks(source, nested);
      else if (entry.isFile() && /\.(js|css)$/.test(entry.name)) {
        const target = join(temporary, 'browser-static', nested); await mkdir(dirname(target), { recursive: true }); await copyFile(source, target); browserChunks++;
      }
    }
  }
  await copyChunks(join(root, 'apps/web/.next/static'));
  const scan = spawnSync('docker', ['run', '--pull=never', '--network', 'none', '--read-only',
    '-v', `${temporary}:/source:ro`, '-v', `${evidence}:/report`, 'ghcr.io/gitleaks/gitleaks:v8.30.1',
    'dir', '/source', '--no-banner', '--no-color', '--ignore-gitleaks-allow', '--redact=100', '--report-format', 'json', '--report-path', '/report/gitleaks-redacted.json', '--exit-code', '2'],
  { cwd: root, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  await writeFile(join(evidence, 'scan.log'), `${scan.stdout || ''}${scan.stderr || ''}`);
  if (![0, 2].includes(scan.status)) throw Error('Secret scanner failed; see local redacted scan log.');
  const findings = JSON.parse(await readFile(join(evidence, 'gitleaks-redacted.json'), 'utf8'));
  const summary = { scope: 'current tracked + untracked text sources and freshly built browser JS/CSS; not git history, archives, dotenv or cloud',
    branch: run('git', ['branch', '--show-current']).trim(), head: run('git', ['rev-parse', 'HEAD']).trim(), dirty: Boolean(run('git', ['status', '--porcelain']).trim()),
    sourceFiles: manifest.length, browserChunks, scannerExitCode: scan.status, manifestSha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    secretFindings: findings.map(({ RuleID, File, StartLine, Fingerprint }) => ({ rule: RuleID, file: File, line: StartLine, fingerprint: Fingerprint })),
    productionBaseline: 'not inspected; local HEAD is not the dirty candidate nor proof of deployed revision', retainedDirectory: temporary };
  await writeFile(join(evidence, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(evidence, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, evidence }, null, 2));
  process.exitCode = scan.status; // Findings require explicit review, never silently pass.
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
