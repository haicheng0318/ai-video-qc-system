import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('video detail exposes V1.1 runs, ratings, hold and appeal without replacing legacy panels', async () => {
  const detail = await readFile(resolve(__dirname, '../../app/videos/[id]/page.tsx'), 'utf8');
  const panel = await readFile(resolve(__dirname, '../components/v11-evaluation-panel.tsx'), 'utf8');
  assert.match(detail, /V11EvaluationPanel/);
  for (const evidence of ['v11-content-review', 'v11-workflow', 'ratings/latest', 'Shadow', '流程挂起', '异议处理中', 'data-rating', 'comprehensive-rating']) assert.match(panel, new RegExp(evidence));
  assert.match(panel, /reason\.trim\(\)\.length < 10/);
});

test('V1.1 benchmark UI requires administrator creation and explicit approval', async () => {
  const panel = await readFile(resolve(__dirname, '../components/v11-benchmark-panel.tsx'), 'utf8');
  assert.match(panel, /user\?\.role === 'admin'/);
  assert.match(panel, /benchmark-profiles/);
  assert.match(panel, /approve/);
  assert.match(panel, /minimumSampleValue/);
  assert.match(panel, /observationWindowDays/);
  assert.match(panel, /'A\+'/);
  assert.match(panel, /'B-'/);
});

test('V1.1 dashboard and cases remain separate from legacy reporting', async () => {
  const dashboard = await readFile(resolve(__dirname, '../../app/dashboard/page.tsx'), 'utf8');
  const cases = await readFile(resolve(__dirname, '../components/case-library-page.tsx'), 'utf8');
  assert.match(dashboard, /V1\.1 七档正式口径/);
  assert.match(dashboard, /严格有效仅包含 S \/ A\+ \/ A \/ B/);
  assert.match(cases, /\/api\/v11\/cases/);
  assert.match(cases, /comprehensiveRating/);
});

test('video list and card prefer current V1.1 data and comprehensive ratings', async () => {
  const list = await readFile(resolve(__dirname, '../../app/videos/page.tsx'), 'utf8');
  const shell = await readFile(resolve(__dirname, '../components/app-shell.tsx'), 'utf8');
  assert.match(list, /video-list-view:\$\{current\.id\}/);
  assert.match(list, /video-list-view:\$\{user\.id\}/);
  assert.doesNotMatch(shell, /removeItem\(`video-list-view:/);
  assert.match(list, /v11DataDecisions\?\.\[0\]\?\.dataRating/);
  assert.match(list, /v11ComprehensiveDecisions\?\.\[0\]/);
  assert.match(list, /comprehensive\?\.comprehensiveRating/);
  assert.ok(list.indexOf('v11DataDecisions?.[0]?.dataRating') < list.indexOf('aiResultReviews?.[0]?.dataGrade'));
  assert.ok(list.indexOf('comprehensive?.comprehensiveRating') < list.indexOf('finalVideoEvaluations?.[0]?.finalGrade'));
});

test('administrator can resolve R and confirm a non-R comprehensive decision without editing its rating', async () => {
  const panel = await readFile(resolve(__dirname, '../components/v11-evaluation-panel.tsx'), 'utf8');
  assert.match(panel, /\/api\/auth\/me/);
  assert.match(panel, /results\[3\]\.value\.user/);
  assert.match(panel, /user\?\.role === 'admin'/);
  assert.match(panel, /comprehensive-rating\/manual/);
  assert.match(panel, /comprehensive-rating\/confirm/);
  assert.match(panel, /decisionId/);
  assert.match(panel, /performanceEligible/);
  assert.match(panel, /确认理由需填写 10–500 个字符/);
  assert.doesNotMatch(panel, /<option value="S">/);
  assert.doesNotMatch(panel, /<option value="A\+">/);
});
