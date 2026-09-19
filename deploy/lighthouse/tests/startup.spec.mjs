import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

test('restarting API launches only the server and never migrates or seeds an account', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'task5-startup-'));
  try {
    for (const executable of ['node', 'npx']) await writeFile(join(temp, executable),
      '#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "$QC_COMMAND_LOG"\n', { mode: 0o700 });
    const entrypoint = fileURLToPath(new URL('../../cloudbase/start-api.sh', import.meta.url));
    // Stub only external executable boundaries and container working directories.
    execFileSync('/bin/sh', ['-c', 'cd() { :; }; . "$1"', 'startup-test', entrypoint], {
      env: { PATH: temp, QC_COMMAND_LOG: join(temp, 'calls') },
    });
    const calls = (await readFile(join(temp, 'calls'), 'utf8')).trim().split('\n');
    assert.equal(calls.length, 1, 'API restart must not run a migration or seed');
    assert.match(calls[0], /node (?:\/app\/apps\/api\/)?dist\/main\.js$/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
