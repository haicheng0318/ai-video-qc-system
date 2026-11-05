import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { V11ContentLatestResponse } from '@ai-video-qc/shared';
import { contentDecisionNotice } from '../lib/v11-content-display';

const content = (changes: Record<string, unknown> = {}): V11ContentLatestResponse => ({
  shadowMode: false, diagnostics: null,
  group: { status: 'adopted', shadowMode: false, runs: [], workflowRevision: { revision: 1 },
    decision: { id: 'decision', totalScore: '75', contentRating: 'B', complianceStatus: 'clear', inputComplete: true, stable: true, decisionSource: 'system', adoptionMethod: 'double_average', ...changes } },
});
test('saved decision is never described as approval to enter the data stage', () => {
  assert.match(contentDecisionNotice(content(), 0, 0), /不代表已通过后续关卡/);
});
test('missing decision and nullable scores never fall back to a run score', () => {
  const value = content(); value.group!.decision = null;
  assert.match(contentDecisionNotice(value, 0, 0), /尚无有效/);
  assert.match(contentDecisionNotice(content({ totalScore: null, contentRating: null, inputComplete: false }), 0, 0), /无法判断/);
});
test('hold and appeal remain blocking even when a decision exists', () => {
  assert.match(contentDecisionNotice(content(), 1, 0), /待处理事项/);
  assert.match(contentDecisionNotice(content(), 0, 1), /异议/);
});
test('shadow and pilot are not formal decisions', () => {
  const shadow = content(); shadow.group!.shadowMode = true;
  assert.match(contentDecisionNotice(shadow, 0, 0), /Shadow/);
  const pilot = content(); pilot.group!.pilotRun = true;
  assert.match(contentDecisionNotice(pilot, 0, 0), /Pilot/);
});
test('nonclear compliance, unstable result and C/D revision are explicit', () => {
  for (const complianceStatus of ['suspected', 'confirmed']) assert.match(contentDecisionNotice(content({ complianceStatus }), 0, 0), /合规/);
  assert.match(contentDecisionNotice(content({ stable: false }), 0, 0), /稳定/);
  for (const contentRating of ['C', 'D']) assert.match(contentDecisionNotice(content({ contentRating }), 0, 0), /返修/);
});
