import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { contentEvaluationDisplay, finalGradeLabels } from '../lib/display-labels';
import { PRODUCT_VERSION } from '@ai-video-qc/shared';

const root = resolve(__dirname, '../..');
test('development tooling does not overlay the application account area', () => {
  assert.match(readFileSync(resolve(root, 'next.config.mjs'), 'utf8'), /devIndicators:\s*false/);
  const css = readFileSync(resolve(root, 'app/experience.css'), 'utf8');
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /\.sidebar[^}]*overflow-y:\s*auto/);
});
test('product version is a presentation-only 1.2.1 marker', () => assert.equal(PRODUCT_VERSION, '1.2.1'));
test('unknown video status is a safe Chinese label without changing its value', () => {
  assert.equal(contentEvaluationDisplay({ videoStatus: 'future_enum', groupStatus: null, activeHoldCount: 0 }).label, '状态待确认');
  assert.equal(finalGradeLabels.effective, '有效');
  assert.equal(finalGradeLabels.invalid, '无效');
});
test('reduced motion has one authoritative rule', () => {
  const css = ['globals.css', 'experience.css'].map(p => readFileSync(resolve(root, 'app', p), 'utf8')).join('\n');
  assert.equal((css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)/g) || []).length, 1);
  assert.match(css, /animation:\s*none\s*!important/);
});
test('case rendering localizes but never rewrites business conclusions', () => {
  const source = readFileSync(resolve(root, 'src/components/case-library-page.tsx'), 'utf8');
  assert.match(source, /displayLabel\(finalGradeLabels, item.businessConclusion\)/);
  const fixture = readFileSync(resolve(root, 'scripts/v121-browser-acceptance.mjs'), 'utf8');
  assert.match(fixture, /searchParams.get\('type'\) === 'negative'/);
  assert.match(fixture, /negative \? 'invalid' : 'effective'/);
});
