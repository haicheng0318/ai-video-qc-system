import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RULE_ENGINE_VERSION, RuleEngineResultView } from '@ai-video-qc/shared';
import { RuleEnginePanel } from '../components/rule-engine-panel';
import { ApiRequestError } from '../lib/api';
import { ResultReview } from '../lib/result-review-ui';
import {
  canExecuteRuleEngine,
  executeRuleEngine,
  loadRuleEngineRequests,
  ruleEngineErrorMessage,
} from '../lib/rule-engine-ui';

const user = (role: string) => ({ id: role, account: role, name: role, role });
const review = {
  id: '00000000-0000-4000-8000-000000000301', resultMetricId: 'metric',
  modelProvider: 'openai', modelName: 'gpt-5-mini', dataScore: 85, dataGrade: 'A',
  dataSufficiency: 'sufficient', isBusinessEffectiveRecommendation: true,
  resultSummary: null, performanceProblems: [], attributionAnalysis: [], optimizationSuggestions: [],
  sufficiencyReasons: [], continueTestRecommendation: null, status: 'succeeded', errorMessage: null,
  createdAt: new Date().toISOString(),
} satisfies ResultReview;

const ruleResult = {
  id: 'rule', videoId: 'video', contentReviewId: 'content', resultReviewId: review.id,
  ruleVersion: RULE_ENGINE_VERSION, contentGrade: 'A', dataGrade: 'A', dataSufficiency: 'sufficient',
  ruleCode: 'R11_CONTENT_HIGH_DATA_HIGH', ruleResult: 'excellent_effective_candidate',
  ruleReason: 'deterministic reason', recommendedBoundary: 'allow_final_effective',
  createdAt: new Date().toISOString(),
} satisfies RuleEngineResultView;

for (const role of ['admin', 'content_owner']) {
  test(`${role} sees rule execution eligibility with a succeeded latest GPT review`, () => {
    assert.equal(canExecuteRuleEngine(user(role), 'pending_rule_engine', review, null), true);
  });
}

for (const role of ['operator', 'advertiser', 'supervisor', 'director']) {
  test(`${role} never receives rule execution eligibility`, () => {
    assert.equal(canExecuteRuleEngine(user(role), 'pending_rule_engine', review, null), false);
  });
}

for (const status of ['submitted', 'pending_result_data', 'ai_result_reviewing', 'ai_result_failed', 'pending_data', 'pending_final_evaluation']) {
  test(`${status} hides rule execution`, () => {
    assert.equal(canExecuteRuleEngine(user('admin'), status, review, null), false);
  });
}

for (const status of ['pending', 'running', 'failed'] as const) {
  test(`${status} GPT review hides rule execution`, () => {
    assert.equal(canExecuteRuleEngine(user('admin'), 'pending_rule_engine', { ...review, status }, null), false);
  });
}

test('missing GPT review hides rule execution', () => {
  assert.equal(canExecuteRuleEngine(user('admin'), 'pending_rule_engine', null, null), false);
});

test('existing rule-engine-v1 result hides duplicate execution', () => {
  assert.equal(canExecuteRuleEngine(user('admin'), 'pending_rule_engine', review, ruleResult), false);
});

test('execute payload contains only resultReviewId', async () => {
  let path = '';
  let body = '';
  await executeRuleEngine(async (requestPath, init) => {
    path = requestPath;
    body = String(init.body);
    return { videoStatus: 'pending_final_evaluation', ruleEngineResult: ruleResult };
  }, 'video', review.id);
  assert.equal(path, '/api/videos/video/rule-engine');
  assert.deepEqual(JSON.parse(body), { resultReviewId: review.id });
});

for (const [status, expected] of [[409, '规则来源或视频状态已变化，请重新加载后再执行。'], [403, '当前角色没有执行规则判断的权限。'], [422, '内容等级、数据等级或数据充分性不符合规则输入要求。']] as const) {
  test(`${status} has a clear Chinese rule engine error`, () => {
    assert.equal(ruleEngineErrorMessage(new ApiRequestError('error', status)), expected);
  });
}

test('GPT latest, rule latest and history failures are isolated', async () => {
  const events: string[] = [];
  await loadRuleEngineRequests({
    loadResultReview: async () => ({ videoStatus: 'pending_rule_engine', review }),
    loadLatest: async () => { throw new Error('latest'); },
    loadHistory: async () => ({ items: [], nextCursor: null }),
    onResultReview: () => events.push('result-review'), onLatest: () => events.push('latest'),
    onHistory: () => events.push('history'), onResultReviewError: () => events.push('result-review-error'),
    onLatestError: () => events.push('latest-error'), onHistoryError: () => events.push('history-error'),
  });
  assert.deepEqual(events.sort(), ['history', 'latest-error', 'result-review']);
});

test('history failure does not block latest result', async () => {
  const events: string[] = [];
  await loadRuleEngineRequests({
    loadResultReview: async () => ({ videoStatus: 'pending_rule_engine', review }),
    loadLatest: async () => ({ videoStatus: 'pending_final_evaluation', ruleEngineResult: ruleResult }),
    loadHistory: async () => { throw new Error('history'); },
    onResultReview: () => events.push('result-review'), onLatest: () => events.push('latest'),
    onHistory: () => events.push('history'), onResultReviewError: () => events.push('result-review-error'),
    onLatestError: () => events.push('latest-error'), onHistoryError: () => events.push('history-error'),
  });
  assert.deepEqual(events.sort(), ['history-error', 'latest', 'result-review']);
});

test('rule panel explains deterministic non-AI execution and candidate boundary', () => {
  const html = renderToStaticMarkup(React.createElement(RuleEnginePanel, {
    videoId: 'video', videoStatus: 'pending_rule_engine', currentUser: user('operator'),
    onVideoRefresh: async () => undefined,
  }));
  assert.match(html, /确定性判断，不调用 AI/);
  assert.match(html, /规则候选结果不是最终有效等级/);
});

test('rule panel does not claim a final verdict, performance result or owner confirmation', () => {
  const html = renderToStaticMarkup(React.createElement(RuleEnginePanel, {
    videoId: 'video', videoStatus: 'pending_rule_engine', currentUser: user('operator'),
    onVideoRefresh: async () => undefined,
  }));
  assert.doesNotMatch(html, /已计入绩效|负责人已确认|优秀案例|反面案例/);
});

test('rule panel source has no polling or automatic execution', async () => {
  const source = await readFile(new URL('../components/rule-engine-panel.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /setInterval|startResultReviewPolling|polling/);
  assert.match(source, /onClick=\{execute\}/);
  assert.doesNotMatch(source, /useEffect\(execute/);
});

test('rule panel clears prior video data and prevents stale requests', async () => {
  const source = await readFile(new URL('../components/rule-engine-panel.tsx', import.meta.url), 'utf8');
  assert.match(source, /setResultReview\(null\)/);
  assert.match(source, /setLatest\(null\)/);
  assert.match(source, /setHistory\(emptyHistory\)/);
  assert.match(source, /requestGeneration\.current/);
});

test('rule panel prevents duplicate clicks and refreshes video, latest and history after success', async () => {
  const source = await readFile(new URL('../components/rule-engine-panel.tsx', import.meta.url), 'utf8');
  assert.match(source, /if \(!resultReview \|\| submitting\) return/);
  assert.match(source, /await onVideoRefresh\(\)/);
  assert.match(source, /await load\(\)/);
});

test('frontend never imports or evaluates backend rule functions', async () => {
  const source = await readFile(new URL('../components/rule-engine-panel.tsx', import.meta.url), 'utf8');
  const helper = await readFile(new URL('../lib/rule-engine-ui.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source + helper, /evaluateRuleBoundary|RULE_ENGINE_V1_RULES/);
});

test('invalid candidate is consistently labelled as a candidate, not a final invalid verdict', async () => {
  const source = await readFile(new URL('../components/rule-engine-panel.tsx', import.meta.url), 'utf8');
  assert.match(source, /invalid_candidate: '无效候选'/);
  assert.doesNotMatch(source, /invalid_candidate: '最终无效'/);
});

test('rule UI never renders AI rawResponse', async () => {
  const source = await readFile(new URL('../components/rule-engine-panel.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /rawResponse/);
});
