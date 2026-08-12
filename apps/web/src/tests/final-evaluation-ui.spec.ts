import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { ApiRequestError } from '../lib/api';
import {
  canTriggerFinalEvaluation,
  finalEvaluationErrorMessage,
  loadFinalEvaluationRequests,
  startFinalEvaluationPolling,
  triggerFinalEvaluation,
} from '../lib/final-evaluation-ui';
import { FinalEvaluationPanel } from '../components/final-evaluation-panel';

const rule = {
  id: 'rule', videoId: 'video', contentReviewId: 'content', resultReviewId: 'result', ruleVersion: 'rule-engine-v1' as const,
  contentGrade: 'A' as const, dataGrade: 'A' as const, dataSufficiency: 'sufficient' as const,
  ruleCode: 'R11_CONTENT_HIGH_DATA_HIGH' as const, ruleResult: 'excellent_effective_candidate' as const,
  ruleReason: '候选边界', recommendedBoundary: 'allow_final_effective' as const, createdAt: new Date().toISOString(),
};
const user = (role: string) => ({ id: 'user', name: role, account: role, role });

for (const role of ['admin', 'content_owner', 'supervisor', 'director', 'operator', 'advertiser']) {
  test(`${role} button eligibility follows Phase 7 permission`, () => {
    assert.equal(canTriggerFinalEvaluation(user(role), 'pending_final_evaluation', rule, null),
      role === 'admin' || role === 'content_owner');
  });
}

for (const status of ['pending_final_evaluation', 'final_evaluation_failed', 'pending_data', 'pending_final_confirmation', 'final_effective']) {
  test(`${status} trigger visibility follows final evaluation state`, () => {
    assert.equal(canTriggerFinalEvaluation(user('admin'), status, rule, null),
      status === 'pending_final_evaluation' || status === 'final_evaluation_failed');
  });
}

test('insufficient rule hides final evaluation trigger', () => {
  assert.equal(canTriggerFinalEvaluation(user('admin'), 'pending_final_evaluation', { ...rule, dataSufficiency: 'insufficient', dataGrade: null }, null), false);
});

test('running evaluation hides duplicate trigger', () => {
  assert.equal(canTriggerFinalEvaluation(user('admin'), 'pending_final_evaluation', rule, { status: 'running' } as any), false);
});

test('succeeded v1 for the same rule hides duplicate trigger', () => {
  assert.equal(canTriggerFinalEvaluation(user('admin'), 'pending_final_evaluation', rule, {
    status: 'succeeded', ruleEngineResultId: 'rule', evaluationVersion: 'final-evaluation-v1',
  } as any), false);
});

test('trigger payload contains only ruleEngineResultId', async () => {
  let body = '';
  await triggerFinalEvaluation(async (_path, init) => { body = String(init.body); return {}; }, 'video', 'rule');
  assert.deepEqual(JSON.parse(body), { ruleEngineResultId: 'rule' });
});

for (const [status, expected] of [[403, '没有生成'], [409, '重新加载'], [422, '规则边界']] as const) {
  test(`${status} has a clear final evaluation message`, () => {
    assert.match(finalEvaluationErrorMessage(new ApiRequestError('x', status)), new RegExp(expected));
  });
}

test('rule, latest and history requests fail independently', async () => {
  const calls: string[] = [];
  await loadFinalEvaluationRequests({
    loadRule: async () => { throw new Error('rule'); },
    loadLatest: async () => ({ videoStatus: 'pending_final_evaluation', evaluation: null }),
    loadHistory: async () => { throw new Error('history'); },
    onRule: () => calls.push('rule'), onLatest: () => calls.push('latest'), onHistory: () => calls.push('history'),
    onRuleError: () => calls.push('rule-error'), onLatestError: () => calls.push('latest-error'), onHistoryError: () => calls.push('history-error'),
  });
  assert.deepEqual(calls.sort(), ['history-error', 'latest', 'rule-error']);
});

for (const terminal of ['succeeded', 'failed'] as const) {
  test(`polling stops after ${terminal}`, async () => {
    const scheduled: Array<() => void> = [];
    let terminalCalls = 0;
    startFinalEvaluationPolling({
      loadLatest: async () => ({ videoStatus: 'x', evaluation: { status: terminal } as any }),
      onLatest: () => undefined, onTerminal: () => { terminalCalls += 1; }, onError: () => undefined,
      schedule: (task) => { scheduled.push(task); return 1 as any; }, cancel: () => undefined,
    });
    await scheduled.shift()?.();
    assert.equal(terminalCalls, 1);
    assert.equal(scheduled.length, 0);
  });
}

test('polling cleanup cancels future requests', async () => {
  const scheduled: Array<() => void> = [];
  let loads = 0;
  const stop = startFinalEvaluationPolling({
    loadLatest: async () => { loads += 1; return { videoStatus: 'x', evaluation: { status: 'running' } as any }; },
    onLatest: () => undefined, onTerminal: () => undefined, onError: () => undefined,
    schedule: (task) => { scheduled.push(task); return 1 as any; }, cancel: () => undefined,
  });
  stop();
  await scheduled.shift()?.();
  assert.equal(loads, 0);
});

test('bounded polling stops after repeated errors', async () => {
  const scheduled: Array<() => void> = [];
  startFinalEvaluationPolling({
    loadLatest: async () => { throw new Error('offline'); }, onLatest: () => undefined,
    onTerminal: () => undefined, onError: () => undefined, maxErrors: 2,
    schedule: (task) => { scheduled.push(task); return 1 as any; }, cancel: () => undefined,
  });
  await scheduled.shift()?.();
  await scheduled.shift()?.();
  assert.equal(scheduled.length, 0);
});

test('panel warns that suggestion is not a final business conclusion', () => {
  const html = renderToStaticMarkup(React.createElement(FinalEvaluationPanel, {
    videoId: 'video', videoStatus: 'pending_final_evaluation', currentUser: user('admin'), onVideoRefresh: async () => undefined,
  }));
  assert.match(html, /GPT 建议不是最终业务结论/);
  assert.match(html, /待确认|负责人确认/);
});

test('GPT suggestion panel remains separate from confirmation commands', async () => {
  const source = await readFile(resolve(__dirname, '../components/final-evaluation-panel.tsx'), 'utf8');
  assert.doesNotMatch(source, /确认最终|手工调整|标记优秀|标记反面/);
  assert.doesNotMatch(source, /submitFinalConfirmation|submitCaseMarking/);
});

test('panel never renders rawResponse or successKey', async () => {
  const source = await readFile(resolve(__dirname, '../components/final-evaluation-panel.tsx'), 'utf8');
  assert.doesNotMatch(source, /rawResponse|successKey/);
});

test('panel does not calculate final recommendations in the frontend', async () => {
  const source = await readFile(resolve(__dirname, '../components/final-evaluation-panel.tsx'), 'utf8');
  assert.doesNotMatch(source, /evaluateRuleBoundary|allowedRecommendations/);
});

test('video detail includes the final suggestion panel after rule engine', async () => {
  const source = await readFile(resolve(__dirname, '../../app/videos/[id]/page.tsx'), 'utf8');
  assert.ok(source.indexOf('<FinalEvaluationPanel') > source.indexOf('<RuleEnginePanel'));
});
