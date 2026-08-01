import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

const repositoryRoot = resolve(process.cwd(), '../..');
const migrationPath = resolve(repositoryRoot, 'prisma/migrations/20260802090000_add_rule_engine_source_bindings/migration.sql');
const schemaPath = resolve(repositoryRoot, 'prisma/schema.prisma');

test('phase 6 adds exactly one clearly named migration directory', async () => {
  const names = await readdir(resolve(repositoryRoot, 'prisma/migrations'));
  assert.equal(names.filter((name) => name.includes('rule_engine_source_bindings')).length, 1);
});

for (const column of ['content_review_id', 'result_review_id', 'rule_version']) {
  test(`phase 6 migration adds ${column}`, async () => {
    assert.match(await readFile(migrationPath, 'utf8'), new RegExp(`"${column}"`));
  });
}

for (const relation of ['ai_content_reviews', 'ai_result_reviews']) {
  test(`phase 6 migration adds foreign key to ${relation}`, async () => {
    const sql = await readFile(migrationPath, 'utf8');
    assert.match(sql, new RegExp(`REFERENCES "${relation}"`));
    assert.match(sql, /ON DELETE RESTRICT/);
  });
}

test('phase 6 migration adds result review and rule version uniqueness', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /UNIQUE INDEX "rule_engine_results_result_review_id_rule_version_key"/);
});

for (const index of ['content_review_id_idx', 'result_review_id_idx', 'video_id_created_at_id_idx']) {
  test(`phase 6 migration adds ${index}`, async () => {
    assert.match(await readFile(migrationPath, 'utf8'), new RegExp(index));
  });
}

test('phase 6 migration does not drop tables, columns or historical data', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN)|DELETE\s+FROM|TRUNCATE/i);
});

test('Prisma schema exposes both source relations and immutable version uniqueness', async () => {
  const schema = await readFile(schemaPath, 'utf8');
  assert.match(schema, /contentReview\s+AiContentReview/);
  assert.match(schema, /resultReview\s+AiResultReview/);
  assert.match(schema, /@@unique\(\[resultReviewId, ruleVersion\]\)/);
});
