import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { formatShanghaiDate, formatShanghaiDateTime } from '../lib/display-time';
import {
  canApplySourceResponse,
  latestMetricForTrigger,
  shouldApplyLatestSelection,
  workflowEvidenceKey,
} from '../lib/workflow-refresh';
import { ResultMetricSnapshot } from '../lib/result-metrics-ui';
import { loadResultReviewRequests, ResultReviewHistory, triggerResultReview } from '../lib/result-review-ui';

test('workflow evidence changes refresh mounted downstream panels without changing video id', async () => {
  assert.notEqual(
    workflowEvidenceKey('pending_result_data', ['submit_result_metrics']),
    workflowEvidenceKey('pending_result_data', ['trigger_result_review']),
  );
  assert.notEqual(
    workflowEvidenceKey('pending_result_data', ['submit_result_metrics', 'trigger_result_review'], ['metric-m1']),
    workflowEvidenceKey('pending_result_data', ['submit_result_metrics', 'trigger_result_review'], ['metric-m2']),
  );
  for (const file of ['result-review-panel.tsx', 'rule-engine-panel.tsx', 'final-evaluation-panel.tsx', 'final-confirmation-panel.tsx']) {
    const source = await readFile(resolve(__dirname, `../components/${file}`), 'utf8');
    assert.match(source, /workflowEvidenceKey\(videoStatus, allowedActions/, file);
  }
});

test('result review panel binds refresh to the server latest metric id', async () => {
  const page = await readFile(resolve(__dirname, '../../app/videos/[id]/page.tsx'), 'utf8');
  const panel = await readFile(resolve(__dirname, '../components/result-review-panel.tsx'), 'utf8');
  assert.match(page, /latestResultMetricId/);
  assert.match(panel, /latestResultMetricId/);
  assert.match(panel, /workflowEvidenceKey\(videoStatus, allowedActions, \[latestResultMetricId\]\)/);
  assert.match(panel, /requestGeneration/);
  assert.match(panel, /AbortController/);
});

test('M2 remains selected and is submitted after the older M1 load resolves late', async () => {
  const metric = (id: string): ResultMetricSnapshot => ({
    id,
    videoId: 'video-1',
    videoType: 'organic',
    submittedBy: null,
    createdAt: '2026-09-10T00:00:00.000Z',
    previousMetricId: null,
    videoStatus: 'pending_result_data',
    dataWarnings: [],
  });
  const m1 = metric('metric-1');
  const m2 = metric('metric-2');
  let releaseM1History!: (value: ResultReviewHistory) => void;
  const delayedM1History = new Promise<ResultReviewHistory>((resolve) => { releaseM1History = resolve; });
  let generation = 0;
  const selected: { current: ResultMetricSnapshot | null } = { current: null };
  const load = (sourceMetric: ResultMetricSnapshot, expectedId: string, history: Promise<ResultReviewHistory>) => {
    const requestGeneration = ++generation;
    return loadResultReviewRequests({
      loadMetric: async () => sourceMetric,
      loadLatest: async () => ({ review: null, videoStatus: 'pending_result_data' }),
      loadHistory: () => history,
      onMetric: (value) => {
        if (canApplySourceResponse(requestGeneration, generation, value?.id, expectedId)) selected.current = value;
      },
      onLatest: () => undefined,
      onHistory: () => undefined,
      onMetricError: () => undefined,
      onLatestError: () => undefined,
      onHistoryError: () => undefined,
    });
  };

  const oldLoad = load(m1, m1.id, delayedM1History);
  await load(m2, m2.id, Promise.resolve({ items: [], nextCursor: null }));
  assert.equal(selected.current?.id, m2.id);
  releaseM1History({ items: [], nextCursor: null });
  await oldLoad;
  assert.equal(selected.current?.id, m2.id);
  const triggerMetric = latestMetricForTrigger(selected.current, m2.id);
  assert.equal(triggerMetric?.id, m2.id);
  assert.equal(latestMetricForTrigger(m1, m2.id), null);
  let submittedMetricId = '';
  await triggerResultReview(async (_path, init) => {
    submittedMetricId = JSON.parse(String(init.body)).resultMetricId;
    return {
      reviewId: 'review-2',
      jobId: 'job-2',
      resultMetricId: submittedMetricId,
      status: 'running',
      videoStatus: 'ai_result_reviewing',
    };
  }, 'video-1', triggerMetric!.id);
  assert.equal(submittedMetricId, m2.id);
});

test('an exact tracked result cannot be replaced by a different latest result', () => {
  assert.equal(shouldApplyLatestSelection('result-a', 'result-b'), false);
  assert.equal(shouldApplyLatestSelection('result-a', 'result-a'), true);
  assert.equal(shouldApplyLatestSelection(null, 'result-b'), true);
});

test('content, result and final panels pin the explicitly tracked result id', async () => {
  for (const file of ['../../app/videos/[id]/page.tsx', '../components/result-review-panel.tsx', '../components/final-evaluation-panel.tsx']) {
    const source = await readFile(resolve(__dirname, file), 'utf8');
    assert.match(source, /shouldApplyLatestSelection/);
    assert.match(source, /pinned(ContentReview|Review|Evaluation)Id/);
  }
});

test('dirty guards stay enabled during submission until success is known', async () => {
  for (const file of [
    '../../app/videos/new/page.tsx',
    '../components/video-revision-panel.tsx',
    '../components/supervisor-review-panel.tsx',
    '../components/result-metrics-panel.tsx',
    '../components/final-confirmation-panel.tsx',
  ]) {
    const source = await readFile(resolve(__dirname, file), 'utf8');
    assert.doesNotMatch(source, /useUnsavedChanges\([^\n]*!submitting/);
  }
});

test('multipart upload binds the cancel signal to the actual request', async () => {
  const source = await readFile(resolve(__dirname, '../../app/videos/new/page.tsx'), 'utf8');
  assert.match(source, /apiFetch<\{ id: string \}>\('\/api\/videos',[\s\S]*?signal: controller\.current\.signal/);
});

test('browser acceptance blocks redirects, service workers and every external browser request', async () => {
  const source = await readFile(resolve(__dirname, '../../scripts/v101-browser-acceptance.mjs'), 'utf8');
  assert.match(source, /redirect:\s*'manual'/);
  assert.match(source, /serviceWorkers:\s*'block'/);
  assert.match(source, /context\.route\('\*\*\/\*'/);
  assert.match(source, /requestUrl\.origin !== parsed\.origin/);
});

test('case export link uses the DTO-compatible upper bound', async () => {
  const source = await readFile(resolve(__dirname, '../components/case-library-page.tsx'), 'utf8');
  assert.match(source, /limit:\s*'50'/);
  assert.doesNotMatch(source, /最多100条|limit:\s*'100'/);
});

test('Shanghai formatter is independent from the browser timezone', () => {
  assert.match(formatShanghaiDateTime('2026-09-10T00:00:00.000Z'), /2026/);
  assert.match(formatShanghaiDateTime('2026-09-10T00:00:00.000Z'), /08:00/);
  assert.match(formatShanghaiDate('2026-09-09T16:00:00.000Z'), /2026/);
});
