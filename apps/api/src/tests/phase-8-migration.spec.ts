import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

const migrationName = '20260808090000_add_final_confirmation_case_metadata';

test('Phase 8 adds exactly one append-only migration after Phase 7', async () => {
  const directories = (await readdir(resolve(__dirname, '../../../../prisma/migrations'))).filter((name) => /^\d/.test(name));
  assert.ok(directories.includes(migrationName)); assert.equal(directories.filter((name) => name.includes('final_confirmation_case')).length, 1);
});

test('Phase 8 migration is safe for existing final evaluation rows', async () => {
  const sql = await readFile(resolve(__dirname, `../../../../prisma/migrations/${migrationName}/migration.sql`), 'utf8');
  for (const column of ['confirmation_comment', 'case_marked_by_id', 'case_marked_at', 'case_note']) assert.match(sql, new RegExp(column));
  assert.doesNotMatch(sql, /TRUNCATE|DELETE FROM|DROP TABLE|NOT NULL/i);
});

test('Phase 8 migration adds required query indexes and case marker foreign key', async () => {
  const sql = await readFile(resolve(__dirname, `../../../../prisma/migrations/${migrationName}/migration.sql`), 'utf8');
  for (const value of ['confirmed_at', 'final_grade', 'can_be_used_for_performance', 'is_excellent_case', 'is_negative_case', 'case_marked_at', 'case_marked_by_id_fkey']) assert.match(sql, new RegExp(value));
});
