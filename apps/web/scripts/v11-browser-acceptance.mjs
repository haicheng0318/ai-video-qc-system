import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserOutput } from './local-browser-output.mjs';
import { localBrowserEnvironment } from './local-browser-environment.mjs';

const { base, target, childEnv } = localBrowserEnvironment(process.env, 'V11_BROWSER_BASE_URL', 'http://127.0.0.1:3111');
const executable = execFileSync('which', ['playwright'], { encoding: 'utf8', env: childEnv }).trim();
const { chromium } = createRequire(realpathSync(executable))('playwright');
const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const output = process.env.QC_BROWSER_OUTPUT_DIR ? resolve(process.env.QC_BROWSER_OUTPUT_DIR, 'workflow') : browserOutput('workflow');
await mkdir(output, { recursive: true });

let server;
if (!process.env.V11_BROWSER_BASE_URL) {
  server = spawn('npm', ['--workspace', '@ai-video-qc/web', 'run', 'dev', '--', '-p', '3111'], {
    cwd: root, stdio: 'ignore', env: childEnv,
  });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${base}/login`, { redirect: 'manual' });
      if (response.ok && new URL(response.url).origin === target.origin) break;
    } catch {}
    if (attempt === 79) throw new Error('Local V1.1 browser server did not become ready.');
    await new Promise((done) => setTimeout(done, 500));
  }
}

const browser = await chromium.launch({
  headless: true,
  env: childEnv,
  ...(process.env.V11_CHROMIUM_EXECUTABLE ? { executablePath: process.env.V11_CHROMIUM_EXECUTABLE } : {}),
});
const videoId = '00000000-0000-4000-8000-000000000011';
const now = '2026-10-12T06:00:00.000Z';
const users = {
  owner: { id: 'owner-1', account: 'director', name: '普通编导', role: 'director' },
  admin: { id: 'admin-1', account: 'admin', name: '系统管理员', role: 'admin' },
};
const video = (user) => ({
  id: videoId, title: 'V1.1 浏览器验收视频', brand: '验收品牌', product: '验收产品', platform: '抖音',
  status: 'pending_result_data', videoType: 'organic', isForAds: false, isTrial: true,
  createdAt: now, updatedAt: now, creator: users.owner, operationLogs: [], revisions: [], versionChain: [],
  allowedActions: [], v11EvaluationGroups: [{ status: 'adopted', decision: { totalScore: '82.0', contentRating: 'A', decisionSource: 'system' }, workflowRevision: { revision: 1 }, holds: [], appeals: [] }],
  v11DataDecisions: [{ dataRating: 'B' }], v11ComprehensiveDecisions: [{ comprehensiveRating: 'A', decisionSource: 'system' }],
});

function contentState(shadow = true) {
  return { group: { id: 'group-1', status: 'adopted', shadowMode: shadow, workflowRevision: { revision: 1 },
    runs: [{ id: 'run-1', runNumber: 1, runRole: 'initial', status: 'succeeded', totalScore: '82.0', contentRating: 'A', stale: false }],
    decision: { id: 'decision-1', totalScore: '82.0', contentRating: 'A', complianceStatus: 'clear', inputComplete: true, stable: true, decisionSource: 'system', adoptionMethod: 'single_after_pilot' } } };
}

async function installFixture(context, initialUser) {
  const state = { user: initialUser, appealed: false, benchmarkApproved: false, benchmarkCreated: false, manualResolved: false, confirmed: false };
  const mutations = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (['data:', 'blob:', 'about:'].includes(url.protocol)) return route.continue();
    if (url.origin !== target.origin) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const method = route.request().method();
    const payload = route.request().postData() ? JSON.parse(route.request().postData()) : null;
    if (method !== 'GET') mutations.push({ method, path: url.pathname, payload });
    let body;
    if (url.pathname === '/api/auth/login') {
      state.user = payload.account === 'admin' ? users.admin : users.owner; body = { user: state.user };
    } else if (url.pathname === '/api/auth/me') body = { user: state.user };
    else if (url.pathname === '/api/auth/quotas') body = { items: [] };
    else if (url.pathname === '/api/videos') body = { items: [video(state.user)], total: 1, page: 1, pageSize: 20 };
    else if (url.pathname === `/api/videos/${videoId}`) body = video(state.user);
    else if (url.pathname.endsWith('/file-url')) body = { url: null };
    else if (url.pathname.endsWith('/content-review/latest')) body = { review: null, videoStatus: 'pending_result_data' };
    else if (url.pathname.endsWith('/supervisor-review/latest') || url.pathname.endsWith('/result-metrics/latest')) body = null;
    else if (url.pathname.endsWith('/result-review/latest')) body = { review: null, videoStatus: 'pending_result_data' };
    else if (url.pathname.endsWith('/rule-engine/latest')) body = { ruleEngineResult: null, videoStatus: 'pending_result_data' };
    else if (url.pathname.endsWith('/final-evaluation/latest')) body = { evaluation: null, videoStatus: 'pending_result_data' };
    else if (url.pathname.includes('/history')) body = { items: [], nextCursor: null };
    else if (url.pathname.endsWith('/v11-content-review/latest')) body = contentState(true);
    else if (url.pathname.endsWith('/v11-workflow') && method === 'GET') body = { revision: { revision: 1, holds: [], appeals: state.appealed ? [{ id: 'appeal-1', reason: '画面证据时间点需要重新核对' }] : [] } };
    else if (url.pathname.endsWith('/v11-workflow/appeals')) { state.appealed = true; body = { id: 'appeal-1' }; }
    else if (url.pathname.endsWith('/v11-content-review')) body = { groupId: 'shadow-group-2', status: 'queued' };
    else if (url.pathname.endsWith('/ratings/latest')) body = { data: { dataRating: 'B', dataSufficiency: 'sufficient' }, comprehensive: state.manualResolved
      ? { id: 'comp-1', comprehensiveRating: 'A', requiresAdminReview: false, decisionSource: 'human', finalStatus: state.confirmed ? 'final_effective' : null, performanceEligible: state.confirmed }
      : { id: 'comp-1', comprehensiveRating: null, requiresAdminReview: true, decisionSource: null, finalStatus: null, performanceEligible: false } };
    else if (url.pathname.endsWith('/comprehensive-rating/manual')) { state.manualResolved = true; body = { id: 'comp-1', comprehensiveRating: payload.rating }; }
    else if (url.pathname.endsWith('/comprehensive-rating/confirm')) { state.confirmed = true; body = { id: 'comp-1', finalStatus: 'final_effective' }; }
    else if (url.pathname === '/api/v11/benchmark-profiles' && method === 'GET') body = state.benchmarkCreated ? [{ id: 'benchmark-1', name: '浏览器验收基准', version: 1, platform: '抖音', brand: null, videoType: 'organic', primaryMetric: 'views', requiredMetrics: ['views'], status: state.benchmarkApproved ? 'approved' : 'draft', enabled: state.benchmarkApproved, thresholds: [] }] : [];
    else if (url.pathname === '/api/v11/benchmark-profiles') { state.benchmarkCreated = true; body = { id: 'benchmark-1' }; }
    else if (url.pathname.endsWith('/benchmark-profiles/benchmark-1/approve')) { state.benchmarkApproved = true; body = { id: 'benchmark-1', status: 'approved' }; }
    else if (url.pathname === '/api/platform-benchmarks') body = { items: [] };
    else if (url.pathname.startsWith('/api/cases')) body = { items: [], nextCursor: null };
    else if (url.pathname.startsWith('/api/v11/cases')) body = { items: [{ evaluationId: 'case-1', videoId, title: 'V1.1 浏览器验收视频', brand: '验收品牌', product: '验收产品', platform: '抖音', videoType: 'organic', creator: users.owner, comprehensiveRating: 'A', businessConclusion: 'effective', decisionSource: 'human', caseNote: '本地浏览器验收案例', caseMarkedAt: now, caseMarkedBy: users.admin }] };
    else if (url.pathname === '/api/dashboard/summary') body = { period: { startDate: now, endDate: now }, finalizedCount: 1, finalEffectiveCount: 1, finalLowEffectiveCount: 0, finalInvalidCount: 0, effectiveOutputCount: 1, finalEffectiveRate: 100, lowEffectiveRate: 0, effectiveOutputRate: 100, invalidRate: 0, performanceEligibleCount: 1, performanceEligibleRate: 100, excellentCaseCount: 1, negativeCaseCount: 0, gptRecommendationMatchedCount: 0, gptMatchRate: null, manualAdjustedCount: 1, manualAdjustmentRate: 100, pipeline: { pendingDataCount: 0, pendingFinalEvaluationCount: 0, finalEvaluationFailedCount: 0, pendingFinalConfirmationCount: 0 }, v11: { finalizedCount: 1, effectiveCount: 1, lowEffectiveCount: 0, invalidCount: 0, performanceEligibleCount: 1, excellentCaseCount: 1, negativeCaseCount: 0 } };
    else if (url.pathname === '/api/dashboard/trend') body = { items: [{ bucket: '2026-10-12', finalizedCount: 1, effectiveCount: 1, lowEffectiveCount: 0, invalidCount: 0, effectiveOutputRate: 100 }] };
    else if (url.pathname === '/api/dashboard/breakdown') body = { items: [{ groupKey: '验收品牌', groupLabel: '验收品牌', finalizedCount: 1, effectiveCount: 1, lowEffectiveCount: 0, invalidCount: 0, effectiveOutputRate: 100 }] };
    else if (url.pathname === '/api/admin/operations/overview') body = { activeUsers: 2, formalVideos: 1, trialVideos: 1, worker: 'idle', jobs: [], observedAt: now };
    else if (url.pathname === '/api/admin/operations/settings') body = { items: [{ key: 'v11_workflow_gates', version: 1, value: { manualContentReviewEnabled: true, manualFinalConfirmationEnabled: true } }], defaults: {} };
    else if (url.pathname === '/api/admin/operations/configuration-revisions') body = { items: [], total: 0, pageSize: 20 };
    else if (url.pathname.startsWith('/api/admin/operations/')) body = { items: [], total: 0, pageSize: 20, groups: [] };
    else body = {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return { state, mutations };
}

async function login(page, account) {
  await page.goto(`${base}/login`);
  await page.getByLabel('账号').fill(account);
  await page.getByLabel('密码').fill('fixture-only-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '视频任务', exact: true }).waitFor();
}

try {
  const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  ownerContext.setDefaultTimeout(15000);
  const ownerFixture = await installFixture(ownerContext, users.owner);
  const ownerPage = await ownerContext.newPage();
  const ownerErrors = []; ownerPage.on('pageerror', (error) => ownerErrors.push(error.message));
  await login(ownerPage, 'director');
  await ownerPage.getByRole('link', { name: 'V1.1 浏览器验收视频', exact: true }).waitFor();
  assert.equal(await ownerPage.getByText('其他账号视频', { exact: true }).count(), 0);
  assert.equal(await ownerPage.getByLabel('上传账号 ID').count(), 0, 'ordinary users cannot filter across owners');
  await ownerPage.getByRole('button', { name: '卡片', exact: true }).click();
  await ownerPage.locator('.video-card').waitFor();
  await ownerPage.locator('.video-card:visible').getByRole('link', { name: 'V1.1 浏览器验收视频', exact: true }).click();
  await ownerPage.getByText('Shadow 结果不改变正式流程。', { exact: true }).waitFor();
  assert.match(await ownerPage.locator('#v11-detail-summary').innerText(), /内容质量[\s\S]*A[\s\S]*数据表现[\s\S]*B[\s\S]*综合评级[\s\S]*R/);
  await ownerPage.getByRole('button', { name: '触发 V1.1 内容评估', exact: true }).click();
  await ownerPage.getByLabel('对当前内容结果提出异议').fill('请重新核对第 3 秒的产品露出证据');
  await ownerPage.getByRole('button', { name: '提交异议并创建新工作流版本', exact: true }).click();
  await ownerPage.getByText('异议处理中：画面证据时间点需要重新核对').waitFor();
  assert.equal(await ownerPage.getByRole('heading', { name: '管理员人工决议' }).count(), 0);
  await ownerPage.goto(`${base}/admin`);
  await ownerPage.waitForURL('**/videos');
  assert.deepEqual(ownerErrors, []);
  await ownerContext.close();

  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  adminContext.setDefaultTimeout(15000);
  const adminFixture = await installFixture(adminContext, users.admin);
  const adminPage = await adminContext.newPage();
  const adminErrors = []; adminPage.on('pageerror', (error) => adminErrors.push(error.message));
  await login(adminPage, 'admin');
  await adminPage.getByText('更多筛选', { exact: true }).click();
  await adminPage.getByLabel('上传账号 ID').waitFor();
  await adminPage.getByLabel('数据等级').selectOption('B');
  await adminPage.getByLabel('综合等级').selectOption('A');
  await adminPage.getByRole('button', { name: '筛选', exact: true }).click();
  await adminPage.waitForURL(/dataRating=B/);
  assert.match(adminPage.url(), /comprehensiveRating=A/);

  await adminPage.goto(`${base}/admin`);
  await adminPage.getByRole('button', { name: '设置与版本', exact: true }).click();
  await adminPage.getByText(/V1.1 人工关卡/).waitFor();
  assert.equal(await adminPage.getByText('保留人工内容审核', { exact: true }).count(), 1);

  await adminPage.goto(`${base}/settings/benchmarks`);
  await adminPage.getByRole('heading', { name: 'V1.1 评价基准', exact: true }).waitFor();
  await adminPage.getByLabel('名称').fill('浏览器验收基准');
  await adminPage.getByRole('button', { name: '创建草稿', exact: true }).click();
  await adminPage.getByText('浏览器验收基准', { exact: true }).waitFor();
  adminPage.once('dialog', (dialog) => dialog.accept('批准本地浏览器验收基准'));
  await adminPage.getByRole('button', { name: '审批', exact: true }).click();
  const benchmarkRow = adminPage.getByRole('row').filter({ hasText: '浏览器验收基准' });
  await benchmarkRow.getByRole('cell', { name: 'approved 启用', exact: true }).waitFor();

  await adminPage.goto(`${base}/videos/${videoId}`);
  await adminPage.getByRole('heading', { name: '管理员人工决议' }).waitFor();
  await adminPage.getByLabel('人工决议理由').fill('证据完整，按冻结矩阵人工处理 R 组合');
  await adminPage.getByRole('button', { name: '提交人工决议', exact: true }).click();
  await adminPage.locator('[data-testid="v11-evaluation-panel"]').getByRole('heading', { name: '负责人最终确认' }).waitFor();
  await adminPage.getByLabel('确认理由').fill('复核来源与安全门禁后确认正式结果');
  await adminPage.getByLabel('纳入绩效参考资格').check();
  await adminPage.getByRole('button', { name: '确认正式结果', exact: true }).click();

  await adminPage.goto(`${base}/cases/excellent`);
  await adminPage.getByText('本地浏览器验收案例', { exact: false }).waitFor();
  await adminPage.goto(`${base}/dashboard`);
  await adminPage.getByText('V1.1 七档正式口径', { exact: false }).waitFor();
  await adminPage.getByText('验收品牌', { exact: true }).waitFor();
  assert.deepEqual(adminErrors, []);
  await adminPage.screenshot({ path: resolve(output, 'admin-dashboard.png'), fullPage: true });
  await adminContext.close();

  assert.ok(ownerFixture.mutations.some((item) => item.path.endsWith('/v11-content-review')));
  assert.ok(ownerFixture.mutations.some((item) => item.path.endsWith('/appeals')));
  assert.ok(adminFixture.mutations.some((item) => item.path.endsWith('/comprehensive-rating/manual')));
  assert.ok(adminFixture.mutations.some((item) => item.path.endsWith('/comprehensive-rating/confirm')));
  const summary = { ok: true, browser: await browser.version(), paidModelCalls: 0,
    ordinary: ['login', 'owner-only list', 'list/card', 'shadow', 'appeal', 'ratings', 'admin denial'],
    admin: ['creator/rating filters', 'gate settings', 'benchmark create/approve', 'R resolution', 'final confirmation', 'case', 'dashboard'] };
  await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} finally {
  await browser.close();
  server?.kill('SIGTERM');
}
