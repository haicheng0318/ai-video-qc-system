import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../../..');
const migrationPath = resolve(root, 'prisma/migrations/20260803090000_add_final_evaluation_ai_recommendation/migration.sql');
const schemaPath = resolve(root, 'prisma/schema.prisma');

test('phase 7 migration refuses a non-empty final evaluation table', async () => {
  assert.match(await readFile(migrationPath, 'utf8'), /IF EXISTS[\s\S]+RAISE EXCEPTION/);
});

for (const column of [
  'evaluation_version', 'status', 'error_message', 'triggered_by_id', 'recommended_final_grade',
  'recommended_final_status', 'recommended_is_effective', 'recommendation_confidence', 'decision_summary',
  'evidence_assessment', 'confirmation_focus', 'risk_flags', 'completed_at', 'success_key',
]) {
  test(`phase 7 migration adds ${column}`, async () => {
    assert.match(await readFile(migrationPath, 'utf8'), new RegExp(`"${column}"`));
  });
}

for (const column of ['content_review_id', 'result_review_id', 'rule_engine_result_id', 'model_provider', 'model_name', 'content_grade', 'data_grade']) {
  test(`phase 7 migration makes ${column} required`, async () => {
    assert.match(await readFile(migrationPath, 'utf8'), new RegExp(`ALTER COLUMN "${column}" SET NOT NULL`));
  });
}

test('phase 7 migration creates unique success key and source indexes', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /CREATE UNIQUE INDEX "final_video_evaluations_success_key_key"/);
  for (const field of ['content_review_id', 'result_review_id', 'rule_engine_result_id', 'triggered_by_id', 'status']) {
    assert.match(sql, new RegExp(`final_video_evaluations_${field}_idx`));
  }
});

test('phase 7 migration adds triggered-by foreign key without deleting data', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /FOREIGN KEY \("triggered_by_id"\) REFERENCES "users"\("id"\)/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|TRUNCATE/i);
});

test('Prisma schema keeps GPT suggestion and manual confirmation fields separate', async () => {
  const schema = await readFile(schemaPath, 'utf8');
  for (const field of ['recommendedFinalGrade', 'recommendedFinalStatus', 'recommendedIsEffective', 'finalGrade', 'finalStatus', 'isEffectiveFinal']) {
    assert.match(schema, new RegExp(`\\b${field}\\b`));
  }
});
