import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { V11AdminContentGroup, V11AdminContentRun, V11PublicContentGroup, V11PublicContentRun } from '@ai-video-qc/shared';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
// These assignments fail Typecheck if public/admin boundaries drift.
const contracts: [
  Equal<V11PublicContentGroup['inputRevision'], undefined>,
  Equal<V11PublicContentRun['factClaimVersion'], undefined>,
  Equal<V11PublicContentRun['structuredOutput'], undefined>,
  Equal<V11AdminContentRun['factClaimVersion'], string | null>,
  Equal<V11AdminContentGroup['inputRevision'], { factClaimVersion: string | null } | null>,
] = [true, true, true, true, true];
test('shared role contract disallows technical fields for public responses', () => {
  assert.ok(contracts.every(Boolean));
});
