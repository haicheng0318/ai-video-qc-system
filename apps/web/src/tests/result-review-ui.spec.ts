import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultReviewPanel } from '../components/result-review-panel';
import { ApiRequestError } from '../lib/api';
import {
  canTriggerResultReview,
  loadResultReviewRequests,
  ResultReview,
  resultReviewErrorMessage,
  shouldDisplayResultScore,
  startResultReviewPolling,
  triggerResultReview,
} from '../lib/result-review-ui';
import { ResultMetricSnapshot } from '../lib/result-metrics-ui';

const user = (role: string) => ({ id: role, account: role, name: role, role });
const metric = { id: 'metric-latest' } as ResultMetricSnapshot;
const review = (status: ResultReview['status'], sufficiency: ResultReview['dataSufficiency'] = 'pending') => ({
  id: 'review', resultMetricId: metric.id, modelProvider: 'openai', modelName: 'gpt-5-mini',
  dataScore: sufficiency === 'sufficient' ? 80 : null,
  dataGrade: sufficiency === 'sufficient' ? 'A' : null,
  dataSufficiency: sufficiency, isBusinessEffectiveRecommendation: sufficiency === 'sufficient' ? true : null,
  resultSummary: null, performanceProblems: [], attributionAnalysis: [], optimizationSuggestions: [],
  sufficiencyReasons: [], continueTestRecommendation: null, status, errorMessage: null,
  createdAt: new Date().toISOString(),
}) satisfies ResultReview;

for (const role of ['admin', 'content_owner', 'operator']) {
  test(`${role} sees trigger for an operation-owned video`, () => {
    assert.equal(canTriggerResultReview(user(role), 'organic', false, 'pending_result_data', metric, null), true);
  });
}

test('advertiser sees trigger for ad video but not operation video', () => {
  assert.equal(canTriggerResultReview(user('advertiser'), 'qianchuan_ad', true, 'pending_result_data', metric, null), true);
  assert.equal(canTriggerResultReview(user('advertiser'), 'organic', false, 'pending_result_data', metric, null), false);
});

for (const role of ['supervisor', 'director']) {
  test(`${role} never sees the GPT trigger`, () => {
    assert.equal(canTriggerResultReview(user(role), 'organic', false, 'pending_result_data', metric, null), false);
  });
}

test('no metric, running review and succeeded same snapshot hide trigger', () => {
  assert.equal(canTriggerResultReview(user('admin'), 'organic', false, 'pending_result_data', null, null), false);
  assert.equal(canTriggerResultReview(user('admin'), 'organic', false, 'pending_result_data', metric, review('running')), false);
  assert.equal(canTriggerResultReview(user('admin'), 'organic', false, 'pending_result_data', metric, review('succeeded', 'sufficient')), false);
});

test('ai_result_failed exposes retry and failed history does not block it', () => {
  assert.equal(canTriggerResultReview(user('operator'), 'organic', false, 'ai_result_failed', metric, review('failed')), true);
});

test('trigger payload contains only the latest resultMetricId', async () => {
  let body = '';
  await triggerResultReview(async (_path, init) => {
    body = String(init.body);
    return { reviewId: 'review', resultMetricId: metric.id, status: 'running', videoStatus: 'ai_result_reviewing' };
  }, 'video', metric.id);
  assert.deepEqual(JSON.parse(body), { resultMetricId: metric.id });
});

test('409 and 403 have clear result review messages', () => {
  assert.equal(resultReviewErrorMessage(new ApiRequestError('conflict', 409)), '当前数据快照或复盘状态已变化，请重新加载。');
  assert.equal(resultReviewErrorMessage(new ApiRequestError('denied', 403)), '当前角色没有触发数据复盘的权限。');
});

test('metric, latest and history failures are isolated', async () => {
  const events: string[] = [];
  await loadResultReviewRequests({
    loadMetric: async () => metric,
    loadLatest: async () => { throw new Error('latest'); },
    loadHistory: async () => ({ items: [], nextCursor: null }),
    onMetric: () => events.push('metric'), onLatest: () => events.push('latest'),
    onHistory: () => events.push('history'), onMetricError: () => events.push('metric-error'),
    onLatestError: () => events.push('latest-error'), onHistoryError: () => events.push('history-error'),
  });
  assert.deepEqual(events.sort(), ['history', 'latest-error', 'metric']);
});

test('polling stops after succeeded and calls terminal once', async () => {
  const scheduled: Array<() => void> = [];
  let terminal = 0;
  const stop = startResultReviewPolling({
    loadLatest: async () => ({ videoStatus: 'pending_rule_engine', review: review('succeeded', 'sufficient') }),
    onLatest: () => undefined, onTerminal: () => { terminal += 1; }, onError: () => undefined,
    schedule: (task) => { scheduled.push(task); return 1 as never; }, cancel: () => undefined,
  });
  scheduled.shift()?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(terminal, 1);
  assert.equal(scheduled.length, 0);
  stop();
});

test('polling stops after failed and cleanup prevents future requests', async () => {
  const scheduled: Array<() => void> = [];
  let calls = 0;
  const stop = startResultReviewPolling({
    loadLatest: async () => { calls += 1; return { videoStatus: 'ai_result_failed', review: review('failed') }; },
    onLatest: () => undefined, onTerminal: () => undefined, onError: () => undefined,
    schedule: (task) => { scheduled.push(task); return 1 as never; }, cancel: () => undefined,
  });
  stop();
  scheduled.shift()?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
});

test('bounded polling stops after repeated failures', async () => {
  const scheduled: Array<() => void> = [];
  let errors = 0;
  startResultReviewPolling({
    loadLatest: async () => { throw new Error('network'); }, onLatest: () => undefined,
    onTerminal: () => undefined, onError: () => { errors += 1; }, maxErrors: 2,
    schedule: (task) => { scheduled.push(task); return scheduled.length as never; }, cancel: () => undefined,
  });
  scheduled.shift()?.();
  await new Promise((resolve) => setImmediate(resolve));
  scheduled.shift()?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(errors, 2);
  assert.equal(scheduled.length, 0);
});

test('insufficient result never displays a synthetic zero score or D grade', () => {
  assert.equal(shouldDisplayResultScore(review('succeeded', 'insufficient')), false);
  assert.equal(shouldDisplayResultScore(review('succeeded', 'sufficient')), true);
});

test('result review panel contains no final grade, performance or rule-engine conclusion', () => {
  const html = renderToStaticMarkup(React.createElement(ResultReviewPanel, {
    videoId: 'video', videoType: 'organic', isForAds: false, videoStatus: 'pending_result_data',
    currentUser: user('supervisor'), onVideoRefresh: async () => undefined,
  }));
  assert.doesNotMatch(html, /最终有效等级|计入绩效|规则引擎结果/);
});

test('component resets data on video change, prevents duplicate submit and never renders rawResponse', async () => {
  const source = await readFile(new URL('../components/result-review-panel.tsx', import.meta.url), 'utf8');
  assert.match(source, /setLatestMetric\(null\)/);
  assert.match(source, /if \(!latestMetric \|\| submitting\) return/);
  assert.doesNotMatch(source, /review\.rawResponse|rawResponse\}/);
});
