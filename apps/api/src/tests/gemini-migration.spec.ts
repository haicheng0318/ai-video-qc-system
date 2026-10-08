import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

const repositoryRoot = resolve(process.cwd(), '../..');
const schemaPath = resolve(repositoryRoot, 'prisma/schema.prisma');
const migrationPath = resolve(repositoryRoot,
  'prisma/migrations/20260919090000_add_content_scoring_version/migration.sql');

test('content review schema persists scoring and prompt versions', async () => {
  const schema = await readFile(schemaPath, 'utf8');
  assert.match(schema, /scoringVersion\s+String\?.*@map\("scoring_version"\)/);
  assert.match(schema, /promptVersion\s+String\?.*@map\("prompt_version"\)/);
});

test('content scoring migration adds nullable version columns and labels legacy successes', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /ADD COLUMN "scoring_version" VARCHAR\(80\)/);
  assert.match(sql, /ADD COLUMN "prompt_version" VARCHAR\(80\)/);
  assert.match(sql, /legacy-model-score-v1/);
  assert.match(sql, /phase-2-content-review-v2-qwen-omni/);
  assert.match(sql, /WHERE "status" = 'succeeded'/);
});

test('content scoring migration never rewrites historical scores or raw responses', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.doesNotMatch(sql, /SET\s+"?(total_score|content_grade|raw_response)"?/i);
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN)|DELETE\s+FROM|TRUNCATE/i);
});
