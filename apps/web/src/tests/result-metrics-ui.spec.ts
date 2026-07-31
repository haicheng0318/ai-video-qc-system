import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getResultMetricFieldConfig } from '@ai-video-qc/shared';
import { ResultMetricsPanel } from '../components/result-metrics-panel';
import { ApiRequestError } from '../lib/api';
import {
  buildResultMetricPayload,
  canSubmitResultMetrics,
  createMetricFormValues,
  formatMetricValue,
  loadResultMetricRequests,
  resultMetricErrorMessage,
  ResultMetricSnapshot,
  submitResultMetricSnapshot,
} from '../lib/result-metrics-ui';

const user = (role: string) => ({ id: role, name: role, account: role, role });

test('different video types expose different result metric fields', () => {
  const product = getResultMetricFieldConfig('product_card', false);
  const ads = getResultMetricFieldConfig('qianchuan_ad', true);
  const live = getResultMetricFieldConfig('live_room_traffic', true);
  assert.ok(product.fields.includes('operatorNote'));
  assert.ok(!product.fields.includes('spend'));
  assert.ok(ads.fields.includes('spend'));
  assert.ok(live.fields.includes('liveRoomEntries'));
});

for (const type of ['product_card', 'organic', 'brand_seeding'] as const) {
  test(`operator sees the edit entry for ${type}`, () => {
    assert.equal(
      canSubmitResultMetrics(user('operator'), type, false, 'approved_for_publish'),
      true,
    );
  });
}

for (const type of ['qianchuan_ad', 'live_room_traffic'] as const) {
  test(`advertiser sees the edit entry for ${type}`, () => {
    assert.equal(
      canSubmitResultMetrics(user('advertiser'), type, true, 'pending_result_data'),
      true,
    );
  });
}

test('operator and advertiser cannot edit the other responsibility type', () => {
  assert.equal(
    canSubmitResultMetrics(user('operator'), 'qianchuan_ad', true, 'approved_for_publish'),
    false,
  );
  assert.equal(
    canSubmitResultMetrics(user('advertiser'), 'organic', false, 'approved_for_publish'),
    false,
  );
});

for (const role of ['supervisor', 'director']) {
  test(`${role} has read-only result metrics`, () => {
    assert.equal(
      canSubmitResultMetrics(user(role), 'product_card', false, 'approved_for_publish'),
      false,
    );
  });
}

test('terminal and AI reviewing statuses keep result metrics read-only', () => {
  assert.equal(
    canSubmitResultMetrics(user('admin'), 'product_card', false, 'ai_result_reviewing'),
    false,
  );
  assert.equal(
    canSubmitResultMetrics(user('admin'), 'product_card', false, 'final_effective'),
    false,
  );
});

test('result metric payload includes baseMetricId and only changed fields', () => {
  const fields = getResultMetricFieldConfig('product_card', false).fields;
  const latest = {
    id: 'metric-1',
    views: 10,
    operatorNote: 'old',
  } as ResultMetricSnapshot;
  const values = createMetricFormValues(fields, latest);
  values.views = '0';
  values.operatorNote = '';
  const payload = buildResultMetricPayload(fields, values, latest);
  assert.deepEqual(payload, {
    baseMetricId: 'metric-1',
    views: 0,
    operatorNote: null,
  });
});

test('percentage and ROI formatting use stored units without multiplying', () => {
  assert.equal(formatMetricValue('ctr', '2.35'), '2.35%');
  assert.equal(formatMetricValue('roi', '2.5'), '2.5 倍');
  assert.equal(formatMetricValue('spend', '10.50'), '¥10.50');
});

test('409 conflict produces the required reload message', () => {
  assert.equal(
    resultMetricErrorMessage(new ApiRequestError('conflict', 409)),
    '数据已被其他人更新，请重新加载后再提交。',
  );
});

test('latest failure does not prevent history from loading', async () => {
  let latestFailed = false;
  let historyLoaded = false;
  await loadResultMetricRequests({
    loadLatest: async () => { throw new Error('latest failed'); },
    loadHistory: async () => ({ items: [], nextCursor: null }),
    onLatest: () => undefined,
    onHistory: () => { historyLoaded = true; },
    onLatestError: () => { latestFailed = true; },
    onHistoryError: () => undefined,
  });
  assert.equal(latestFailed, true);
  assert.equal(historyLoaded, true);
});

test('history failure does not prevent latest snapshot from loading', async () => {
  let latestLoaded = false;
  let historyFailed = false;
  await loadResultMetricRequests({
    loadLatest: async () => ({ id: 'metric-1' } as ResultMetricSnapshot),
    loadHistory: async () => { throw new Error('history failed'); },
    onLatest: () => { latestLoaded = true; },
    onHistory: () => undefined,
    onLatestError: () => undefined,
    onHistoryError: () => { historyFailed = true; },
  });
  assert.equal(latestLoaded, true);
  assert.equal(historyFailed, true);
});

test('successful submission sends payload then refreshes latest snapshot and video', async () => {
  const events: string[] = [];
  let body = '';
  await submitResultMetricSnapshot(
    async (_path, init) => {
      events.push('request');
      body = String(init?.body);
      return { id: 'metric-2' };
    },
    'video-1',
    { baseMetricId: 'metric-1', views: 20 },
    async () => { events.push('metrics'); },
    async () => { events.push('video'); },
  );
  assert.deepEqual(events, ['request', 'metrics', 'video']);
  assert.deepEqual(JSON.parse(body), { baseMetricId: 'metric-1', views: 20 });
});

test('result metric panel shows percentage and ROI units and no final conclusions', () => {
  const html = renderToStaticMarkup(React.createElement(ResultMetricsPanel, {
    videoId: 'video',
    videoType: 'qianchuan_ad',
    isForAds: true,
    videoStatus: 'approved_for_publish',
    currentUser: user('advertiser'),
    onVideoRefresh: async () => undefined,
  }));
  assert.match(html, /点击率（%）/);
  assert.match(html, /ROI（倍）/);
  assert.doesNotMatch(html, /数据等级|最终有效|计入绩效|GPT/);
});

test('read-only roles do not render the snapshot save command', () => {
  const html = renderToStaticMarkup(React.createElement(ResultMetricsPanel, {
    videoId: 'video',
    videoType: 'organic',
    isForAds: false,
    videoStatus: 'approved_for_publish',
    currentUser: user('director'),
    onVideoRefresh: async () => undefined,
  }));
  assert.doesNotMatch(html, /保存新数据快照/);
  assert.match(html, /只读/);
});

test('history implementation remains read-only and has no delete request', async () => {
  const source = await readFile(
    new URL('../components/result-metrics-panel.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /method:\s*['"]DELETE['"]/);
  assert.doesNotMatch(source, /删除快照/);
});
