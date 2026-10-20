import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// tsx uses classic JSX for this repo's jsx:preserve; Next supplies its own JSX runtime.
const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
after(() => { if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React'); });
const badges = () => { const path = '../components/ui/badges.tsx'; return import(path); };

for (const [grade, suffix] of [['S', 's'], ['A+', 'a-plus'], ['A', 'a'], ['B', 'b'], ['B-', 'b-minus'], ['C', 'c'], ['D', 'd']]) {
  test(`GradeBadge renders literal ${grade} with accessible text`, async () => {
    const { GradeBadge } = await badges();
    const html = renderToStaticMarkup(React.createElement(GradeBadge, { grade }));
    assert.ok(html.includes(`>${grade}</span>`));
    assert.ok(html.includes(`aria-label="等级 ${grade}"`));
    assert.ok(html.includes(`grade-${suffix}`));
  });
}

test('GradeBadge preserves missing and unknown grade text without inventing a rating', async () => {
  const { GradeBadge } = await badges();
  for (const grade of [undefined, null, '']) assert.match(renderToStaticMarkup(React.createElement(GradeBadge, { grade })), /grade-unknown[^>]*aria-label="等级 未评定">未评定/);
  assert.match(renderToStaticMarkup(React.createElement(GradeBadge, { grade: 'R' })), />R<\/span>/);
});

const statuses: Record<string, string[]> = {
  neutral: ['submitted', 'unknown_future_status'],
  processing: ['ai_content_reviewing', 'ai_result_reviewing', 'pending_rule_engine', 'pending_final_evaluation'],
  waiting: ['pending_supervisor_review', 'pending_final_confirmation', 'pending_result_data', 'pending_data', 'revision_required'],
  completed: ['approved_for_publish', 'final_effective', 'final_low_effective'],
  failed: ['final_invalid', 'invalid_content', 'ai_content_failed', 'ai_result_failed', 'final_evaluation_failed'],
  hold: ['hold'], appeal: ['appeal'],
};
for (const [tone, values] of Object.entries(statuses)) {
  test(`StatusBadge maps ${tone} states and always renders status text`, async () => {
    const { StatusBadge } = await badges();
    for (const status of values) {
      const html = renderToStaticMarkup(React.createElement(StatusBadge, { status }));
      assert.ok(html.includes(`status-${tone}`), status);
      assert.ok(html.includes(`>${status}</span>`), status);
    }
  });
}

test('StatusBadge supports explicit labels, child text, tone override and missing status', async () => {
  const { StatusBadge } = await badges();
  assert.match(renderToStaticMarkup(React.createElement(StatusBadge, { status: 'hold', label: '流程已暂停' })), />流程已暂停<\/span>/);
  assert.match(renderToStaticMarkup(React.createElement(StatusBadge, { status: 'hold', label: '标签', tone: 'waiting' }, '子文本')), /status-waiting[^>]*>子文本<\/span>/);
  assert.match(renderToStaticMarkup(React.createElement(StatusBadge)), /status-neutral[^>]*>未开始<\/span>/);
});
