import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfigFromFile } from '@prisma/config';

test('Prisma config merger preserves schema and migration paths without loading dotenv', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-qc-prisma-config-'));
  const sentinel = 'QC_CONFIG_MERGER_TEST_DOTENV';
  const previous = process.env[sentinel];
  delete process.env[sentinel];
  try {
    await writeFile(join(directory, '.env'), `${sentinel}=must-not-be-loaded\n`);
    await writeFile(join(directory, 'prisma.config.mjs'),
      "export default { schema: './prisma/schema.prisma', migrations: { path: './prisma/migrations', seed: 'node prisma/seed.cjs' } };\n");
    const result = await loadConfigFromFile({ configRoot: directory, configFile: 'prisma.config.mjs' });
    assert.equal(result.error, undefined);
    assert.ok(result.config);
    assert.equal(result.config.schema, join(directory, 'prisma/schema.prisma'));
    assert.equal(result.config.migrations?.path, join(directory, 'prisma/migrations'));
    assert.equal(result.config.migrations?.seed, 'node prisma/seed.cjs');
    assert.equal(process.env[sentinel], undefined);
  } finally {
    if (previous === undefined) delete process.env[sentinel]; else process.env[sentinel] = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
