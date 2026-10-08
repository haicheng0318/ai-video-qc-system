import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserOutput } from './local-browser-output.mjs';
import { localBrowserEnvironment } from './local-browser-environment.mjs';

const { base: baseUrl, target: parsed, childEnv } = localBrowserEnvironment(process.env, 'BROWSER_BASE_URL', 'http://127.0.0.1:3107');
const playwrightCli = execFileSync('which', ['playwright'], { encoding: 'utf8', env: childEnv }).trim();
const { chromium } = createRequire(realpathSync(playwrightCli))('playwright');
const repositoryRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const output = browserOutput('workflow');
await mkdir(output, { recursive: true });

let server;
if (!process.env.BROWSER_BASE_URL) {
  server = spawn('npm', ['--workspace', '@ai-video-qc/web', 'run', 'dev', '--', '-p', '3107'], {
    cwd: repositoryRoot,
    stdio: 'ignore',
    env: childEnv,
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/login`, { redirect: 'manual' });
      if (response.status >= 300 && response.status < 400) throw new Error('Local readiness endpoint redirected.');
      if (response.ok && new URL(response.url).origin === parsed.origin) break;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    if (attempt === 59) throw new Error('Local Next.js server did not become ready.');
  }
}

const browser = await chromium.launch({ headless: true, env: childEnv });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  await context.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (['data:', 'blob:', 'about:'].includes(requestUrl.protocol)) return route.continue();
    if (requestUrl.origin !== parsed.origin) return route.abort('blockedbyclient');
    return route.continue();
  });
  const page = await context.newPage();
  const id = '00000000-0000-4000-8000-000000000001';
  const user = { id: 'owner', account: 'preview', name: '本地验收用户', role: 'content_owner' };
  const now = '2026-09-10T02:00:00.000Z';
  const ids = { review: 'review-1', resultJob: 'job-result', rule: 'rule-1', evaluation: 'evaluation-1', finalJob: 'job-final' };
  const flow = { status: 'pending_result_data', actions: ['submit_result_metrics', 'export_report'], metric: null, review: null, rule: null, evaluation: null };
  let metricWrites = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    let body = {};
    if (path === '/api/auth/me') body = { user };
    else if (path === '/api/auth/quotas') body = { items: [] };
    else if (path === '/api/auth/business-options') body = { platforms: ['抖音'], videoTypes: ['product_card', 'qianchuan_ad', 'live_room_traffic', 'organic', 'brand_seeding', 'other'] };
    else if (path === `/api/videos/${id}`) body = {
      id, title: 'V1.01 本地验收视频', status: flow.status, videoType: 'product_card', isForAds: false,
      isEventVideo: false, createdAt: now, updatedAt: now, creator: user,
      brand: '测试品牌', platform: '抖音', operationLogs: [], revisions: [], versionChain: [], allowedActions: flow.actions,
      aiResultReviews: flow.review ? [flow.review] : [], finalVideoEvaluations: flow.evaluation ? [flow.evaluation] : [],
      latestResultMetricId: flow.metric?.id || null,
    };
    else if (path.endsWith('/content-review/latest')) body = { review: null, videoStatus: flow.status };
    else if (path.endsWith('/supervisor-review/latest')) body = null;
    else if (path.endsWith('/result-metrics/latest')) body = flow.metric;
    else if (path.endsWith('/result-metrics') && method === 'POST') {
      metricWrites += 1;
      const payload = JSON.parse(route.request().postData() || '{}');
      flow.metric = { ...flow.metric, ...payload, id: `metric-${metricWrites}`, videoId: id, videoType: 'product_card', submittedBy: user,
        createdAt: now, previousMetricId: metricWrites > 1 ? `metric-${metricWrites - 1}` : null, videoStatus: flow.status, dataWarnings: [] };
      flow.actions = ['submit_result_metrics', 'trigger_result_review', 'export_report'];
      body = flow.metric;
    }
    else if (path.endsWith('/result-review/latest')) body = { review: flow.review, videoStatus: flow.status, jobId: flow.review?.status === 'running' ? ids.resultJob : null };
    else if (path.endsWith('/result-review') && method === 'POST') {
      const payload = JSON.parse(route.request().postData() || '{}');
      if (payload.resultMetricId !== 'metric-2') throw new Error(`Mounted result panel submitted stale metric evidence: ${payload.resultMetricId}`);
      flow.review = { id: ids.review, resultMetricId: 'metric-2', modelProvider: 'aliyun_bailian', modelName: 'fixture', dataScore: null,
        dataGrade: null, dataSufficiency: 'pending', isBusinessEffectiveRecommendation: null, resultSummary: null,
        performanceProblems: [], attributionAnalysis: [], optimizationSuggestions: [], sufficiencyReasons: [], continueTestRecommendation: null,
        status: 'running', errorMessage: null, createdAt: now };
      flow.status = 'ai_result_reviewing'; flow.actions = ['export_report'];
      body = { reviewId: ids.review, jobId: ids.resultJob, resultMetricId: 'metric-2', status: 'running', videoStatus: flow.status };
    }
    else if (path === `/api/evaluation-jobs/${ids.resultJob}`) {
      flow.review = { ...flow.review, status: 'succeeded', dataScore: 90, dataGrade: 'A', dataSufficiency: 'sufficient',
        isBusinessEffectiveRecommendation: true, resultSummary: '精确任务 A 结果', continueTestRecommendation: 'continue' };
      flow.status = 'pending_rule_engine'; flow.actions = ['execute_rule_engine', 'export_report'];
      body = { status: 'succeeded', stage: 'result', reviewId: ids.review };
    }
    else if (path.endsWith(`/result-reviews/${ids.review}`)) body = { review: flow.review, videoStatus: flow.status };
    else if (path.endsWith('/rule-engine/latest')) body = { ruleEngineResult: flow.rule, videoStatus: flow.status };
    else if (path.endsWith('/rule-engine') && method === 'POST') {
      const payload = JSON.parse(route.request().postData() || '{}');
      if (payload.resultReviewId !== ids.review) throw new Error('Mounted rule panel submitted stale review evidence.');
      flow.rule = { id: ids.rule, videoId: id, contentReviewId: 'content-1', resultReviewId: ids.review,
        ruleVersion: 'rule-engine-v1', contentGrade: 'A', dataGrade: 'A', dataSufficiency: 'sufficient',
        ruleCode: 'R11_CONTENT_HIGH_DATA_HIGH', ruleResult: 'excellent_effective_candidate', ruleReason: '本地固定规则',
        recommendedBoundary: 'allow_final_effective', createdAt: now };
      flow.status = 'pending_final_evaluation'; flow.actions = ['trigger_final_evaluation', 'export_report'];
      body = { ruleEngineResult: flow.rule, videoStatus: flow.status };
    }
    else if (path.endsWith('/final-evaluation/latest')) body = { evaluation: flow.evaluation, videoStatus: flow.status, jobId: flow.evaluation?.status === 'running' ? ids.finalJob : null };
    else if (path.endsWith('/final-evaluation') && method === 'POST') {
      const payload = JSON.parse(route.request().postData() || '{}');
      if (payload.ruleEngineResultId !== ids.rule) throw new Error('Mounted final panel submitted stale rule evidence.');
      flow.evaluation = { id: ids.evaluation, contentReviewId: 'content-1', resultReviewId: ids.review, ruleEngineResultId: ids.rule,
        evaluationVersion: 'final-evaluation-v1', modelProvider: 'aliyun_bailian', modelName: 'fixture', contentGrade: 'A', dataGrade: 'A',
        recommendedFinalGrade: null, recommendedFinalStatus: null, recommendedIsEffective: null, recommendationConfidence: null,
        decisionSummary: null, evidenceAssessment: [], finalAttribution: [], finalSuggestion: null, confirmationFocus: [], riskFlags: [],
        status: 'running', errorMessage: null, createdAt: now, completedAt: null, finalGrade: null, finalStatus: null,
        isEffectiveFinal: null, canBeUsedForPerformance: false, confirmedBy: null, confirmedAt: null, manualAdjustReason: null,
        confirmationComment: null, isExcellentCase: false, isNegativeCase: false, caseMarkedAt: null, caseNote: null };
      flow.actions = ['export_report'];
      body = { evaluationId: ids.evaluation, jobId: ids.finalJob, status: 'running', videoStatus: flow.status };
    }
    else if (path === `/api/evaluation-jobs/${ids.finalJob}`) {
      flow.evaluation = { ...flow.evaluation, status: 'succeeded', recommendedFinalGrade: 'effective', recommendedFinalStatus: 'final_effective',
        recommendedIsEffective: true, recommendationConfidence: 95, decisionSummary: '精确任务 A 最终建议', finalSuggestion: '确认有效', completedAt: now };
      flow.status = 'pending_final_confirmation'; flow.actions = ['confirm_final_evaluation', 'export_report'];
      body = { status: 'succeeded', stage: 'final', evaluationId: ids.evaluation };
    }
    else if (path.endsWith(`/final-evaluations/${ids.evaluation}`)) body = { evaluation: flow.evaluation, videoStatus: flow.status };
    else if (path.endsWith('/final-confirmation') && method === 'POST') {
      flow.evaluation = { ...flow.evaluation, finalGrade: 'effective', finalStatus: 'final_effective', isEffectiveFinal: true,
        confirmedBy: user, confirmedAt: now, confirmationComment: null };
      flow.status = 'final_effective'; flow.actions = ['mark_case', 'export_report'];
      body = { evaluation: flow.evaluation, videoStatus: flow.status };
    }
    else if (path.includes('/history')) body = { items: [], nextCursor: null };
    else if (path.endsWith('/file-url')) body = { url: null };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const externalRequestBlocked = await page.evaluate(() => fetch('https://external.invalid/task3-probe').then(() => false, () => true));
  if (!externalRequestBlocked) throw new Error('External browser request was not blocked.');
  await page.goto(`${baseUrl}/videos/${id}`);
  await page.getByRole('heading', { name: 'V1.01 本地验收视频' }).waitFor();
  if (await page.locator('[role="tab"]').count() !== 8) throw new Error('Expected eight workflow tabs.');
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) throw new Error('Desktop page overflows horizontally.');
  await page.screenshot({ path: `${output}/detail-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) throw new Error('Mobile page overflows horizontally.');
  await page.screenshot({ path: `${output}/detail-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByRole('tab', { name: '运营投放数据' }).click();
  await page.locator('#metric-dataStartDate').fill('2026-09-01');
  await page.locator('#metric-dataEndDate').fill('2026-09-10');
  page.once('dialog', (dialog) => dialog.accept());
  const firstMetricSaved = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/result-metrics') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '保存新数据快照' }).click();
  await firstMetricSaved;
  await page.locator('#metric-dataEndDate').fill('2026-09-11');
  page.once('dialog', (dialog) => dialog.accept());
  const secondMetricSaved = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/result-metrics') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '保存新数据快照' }).click();
  await secondMetricSaved;
  await page.getByRole('tab', { name: '数据复盘' }).click();
  await page.getByText('绑定快照：metric-2').waitFor();
  await page.getByRole('button', { name: '开始千问数据复盘' }).click();
  await page.getByText('精确任务 A 结果').waitFor();
  await page.getByRole('tab', { name: '规则与最终建议' }).click();
  await page.getByRole('button', { name: '执行规则判断' }).click();
  await page.getByRole('button', { name: '生成千问最终评定建议' }).click();
  await page.getByText('精确任务 A 最终建议').waitFor();
  await page.getByRole('tab', { name: '负责人确认' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '确认正式结论' }).click();
  await page.getByText('正式等级：有效').waitFor();

  await page.goto(`${baseUrl}/videos/new`);
  await page.locator('#title').fill('未保存标题');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('link', { name: '视频列表' }).click();
  if (!page.url().endsWith('/videos/new') || await page.locator('#title').inputValue() !== '未保存标题') throw new Error('Unsaved same-origin navigation did not preserve the draft DOM.');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.evaluate(() => window.next.router.push('/videos'));
  await page.waitForTimeout(100);
  if (!page.url().endsWith('/videos/new') || await page.locator('#title').inputValue() !== '未保存标题') throw new Error('Actual Next router.push did not preserve the draft DOM.');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.evaluate(() => window.navigation.navigate('/videos'));
  await page.waitForTimeout(100);
  if (!page.url().endsWith('/videos/new') || await page.locator('#title').inputValue() !== '未保存标题') throw new Error('Unsaved programmatic navigation did not preserve the draft DOM.');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.goBack({ timeout: 1_000 }).catch(() => null);
  if (!page.url().endsWith('/videos/new') || await page.locator('#title').inputValue() !== '未保存标题') throw new Error('Unsaved browser history navigation did not preserve the draft DOM.');
  console.log(JSON.stringify({ ok: true, screenshots: [`${output}/detail-desktop.png`, `${output}/detail-mobile.png`] }));
} finally {
  await browser.close();
  server?.kill('SIGTERM');
}
