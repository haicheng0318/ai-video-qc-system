import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const apiRoot = resolve(__dirname, '../..');
function program(configName: string) {
  const path = join(apiRoot, configName);
  const config = ts.readConfigFile(path, ts.sys.readFile);
  assert.equal(config.error, undefined, `${configName} must exist`);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, apiRoot);
  assert.deepEqual(parsed.errors, []);
  return ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true, incremental: false });
}
test('production compiler roots at src and never includes tests or Web source', () => {
  const production = program('tsconfig.build.json');
  assert.equal(production.getCompilerOptions().rootDir, join(apiRoot, 'src'));
  const sources = production.getSourceFiles().map(file => file.fileName);
  assert.ok(sources.some(file => file === join(apiRoot, 'src/main.ts')));
  assert.ok(sources.some(file => file === join(apiRoot, 'src/worker.ts')));
  assert.ok(sources.every(file => !file.includes('/apps/web/src/') && !file.includes('/api/src/tests/')));
});
test('development Typecheck still includes cross-layer tests and their Web dependency', () => {
  const sources = program('tsconfig.json').getSourceFiles().map(file => file.fileName);
  assert.ok(sources.some(file => file.endsWith('/tests/v11-diagnostics-http.integration.spec.ts')));
  assert.ok(sources.some(file => file.endsWith('/web/src/lib/v11-content-display.ts')));
});
test('standard build always runs the artifact layout guard', async () => {
  const packageJson = JSON.parse(await readFile(join(apiRoot, 'package.json'), 'utf8'));
  assert.match(packageJson.scripts.build, /tsconfig\.build\.json/);
  assert.match(packageJson.scripts.build, /&& node scripts\/check-build-output\.cjs/);
});
test('artifact guard accepts flat output and rejects missing entries, nested output and compiled tests', async () => {
  const { assertBuildOutput } = require('../../scripts/check-build-output.cjs');
  const root = await mkdtemp(join(tmpdir(), 'aiqc-build-guard-'));
  try {
    for (const entry of ['app.module.js', 'main.js', 'worker.js']) await writeFile(join(root, entry), 'throw Error("must not execute build output");');
    assert.doesNotThrow(() => assertBuildOutput(root));
    for (const directory of ['api/src', 'web', 'tests']) {
      await mkdir(join(root, directory), { recursive: true });
      assert.throws(() => assertBuildOutput(root), /Forbidden build output/);
      await rm(join(root, directory.split('/')[0]), { recursive: true });
    }
    await rm(join(root, 'worker.js'));
    assert.throws(() => assertBuildOutput(root), /Missing build entry.*worker/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
