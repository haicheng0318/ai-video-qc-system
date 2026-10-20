import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { localBrowserEnvironment } from './local-browser-environment.mjs';

const { base, target, childEnv } = localBrowserEnvironment(process.env, 'UI2_BROWSER_BASE_URL', 'http://127.0.0.1:3118');
const { chromium } = createRequire(realpathSync(execFileSync('which', ['playwright'], { encoding: 'utf8', env: childEnv }).trim()))('playwright');
const output = resolve(process.env.UI2_ACCEPTANCE_DIR || '.superpowers/ui2-acceptance');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, env: childEnv });
const owner = { id: '00000000-0000-4000-8000-000000000001', name: '林予安', account: 'owner', role: 'director' };
const other = { id: '00000000-0000-4000-8000-000000000002', name: '陈思远', account: 'other', role: 'director' };
const videoId = '00000000-0000-4000-8000-000000000011';
const now = '2026-10-12T06:00:00.000Z';
const group = { status: 'adopted', shadowMode: true, runs: [{ id: 'run-1', runNumber: 1, runRole: 'initial', status: 'succeeded', totalScore: '82', contentRating: 'A', complianceStatus: 'clear', stale: false }], decision: { id: 'decision-1', totalScore: '82', contentRating: 'A', complianceStatus: 'clear', inputComplete: true, stable: true, decisionSource: 'system', adoptionMethod: 'single' }, workflowRevision: { revision: 1 }, holds: [{ id: 'hold-1' }], appeals: [{ id: 'appeal-1' }] };
const videos = Array.from({ length: 26 }, (_, index) => ({ id: index ? `00000000-0000-4000-8000-${String(index + 11).padStart(12, '0')}` : videoId, title: index ? `秋季内容评估 · ${index + 1}` : '秋日新品 · 日常清洁场景', brand: '清研', product: '洁净系列', platform: index % 2 ? '小红书' : '抖音', videoType: index % 2 ? 'organic' : 'product_card', status: index % 2 ? 'submitted' : 'pending_result_data', isForAds: false, createdAt: index < 3 ? now : '2026-08-15T04:00:00.000Z', updatedAt: now, creator: index % 2 ? other : owner, v11EvaluationGroups: [group], v11DataDecisions: [{ dataRating: 'B' }], v11ComprehensiveDecisions: [{ comprehensiveRating: 'A', decisionSource: 'system' }] }));
const summary = { period: { startDate: now, endDate: now }, finalizedCount: 24, finalEffectiveCount: 15, finalLowEffectiveCount: 6, finalInvalidCount: 3, effectiveOutputCount: 21, effectiveOutputRate: 87.5, finalEffectiveRate: 62.5, lowEffectiveRate: 25, invalidRate: 12.5, performanceEligibleCount: 18, performanceEligibleRate: 75, excellentCaseCount: 4, negativeCaseCount: 2, manualAdjustedCount: 3, manualAdjustmentRate: 12.5, gptRecommendationMatchedCount: 20, gptMatchRate: 83.3, pipeline: { pendingDataCount: 4, pendingFinalEvaluationCount: 2, finalEvaluationFailedCount: 0, pendingFinalConfirmationCount: 3 }, v11: { finalizedCount: 24, effectiveCount: 15, lowEffectiveCount: 6, invalidCount: 3, performanceEligibleCount: 18, excellentCaseCount: 4, negativeCaseCount: 2 } };

async function fixture(context, role, allowedActions = ['submit_result_metrics', 'trigger_result_review', 'export_report']) {
  const requests = [];
  const user = { ...owner, role };
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== target.origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    requests.push({ method: request.method(), path: url.pathname, query: url.search, payload: request.postDataJSON?.() });
    assert.equal(request.method(), 'GET', 'UI2 visual suite is read-only; mutations are covered by existing local runtime suites');
    let body = { items: [], total: 0, pageSize: 20 };
    const path = url.pathname;
    if (path === '/api/auth/me') body = { user };
    else if (path === '/api/auth/quotas') body = { quotas: [], expiresAt: null };
    else if (path === '/api/auth/business-options') body = { platforms: ['抖音', '小红书'], videoTypes: ['product_card', 'organic'] };
    else if (path === '/api/videos') {
      const q = url.searchParams;
      const rows = videos.filter(v => (role === 'admin' || v.creator.id === owner.id)
        && (!q.get('month') || v.createdAt.startsWith(q.get('month')))
        && (!q.get('search') || v.title.includes(q.get('search')))
        && (!q.get('creatorId') || v.creator.id === q.get('creatorId'))
        && (!q.get('status') || v.status === q.get('status'))
        && (!q.get('videoType') || v.videoType === q.get('videoType'))
        && (!q.get('platform') || v.platform === q.get('platform')));
      const page = Number(q.get('page') || 1), pageSize = Number(q.get('pageSize') || 20);
      body = { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize };
    } else if (path === `/api/videos/${videoId}`) body = { ...videos[0], creator: owner, isEventVideo: false, relatedRequirement: '', operationLogs: [{ id: 'log-1', actionType: 'video_uploaded', createdAt: now }], version: 1, revisions: [], versionChain: [], allowedActions, aiResultReviews: [], finalVideoEvaluations: [], latestResultMetricId: null };
    else if (path.endsWith('/file-url')) body = { url: null };
    else if (path.endsWith('/content-review/latest')) body = { review: null, videoStatus: 'pending_result_data' };
    else if (path.endsWith('/supervisor-review/latest') || path.endsWith('/result-metrics/latest')) body = null;
    else if (path.endsWith('/result-review/latest')) body = { review: null, videoStatus: 'pending_result_data' };
    else if (path.endsWith('/rule-engine/latest')) body = { ruleEngineResult: null, videoStatus: 'pending_result_data' };
    else if (path.endsWith('/final-evaluation/latest')) body = { evaluation: null, videoStatus: 'pending_result_data' };
    else if (path.endsWith('/v11-content-review/latest')) body = { group };
    else if (path.endsWith('/v11-workflow')) body = { revision: { revision: 1, holds: [{ id: 'hold-1', reason: '等待复核素材完整性' }], appeals: [{ id: 'appeal-1', reason: '产品露出证据需要复核' }] } };
    else if (path.endsWith('/ratings/latest')) body = { data: { dataRating: 'B', dataSufficiency: 'sufficient' }, comprehensive: { id: 'comprehensive-1', comprehensiveRating: 'A', requiresAdminReview: false, finalStatus: 'final_effective', performanceEligible: true, decisionSource: 'human' } };
    else if (path.includes('/history')) body = { items: [], nextCursor: null };
    else if (path === '/api/dashboard/summary') body = summary;
    else if (path === '/api/dashboard/trend') body = { items: [{ bucket: '2026-10-12', finalizedCount: 8, effectiveCount: 6, lowEffectiveCount: 1, invalidCount: 1, effectiveOutputRate: 87.5 }] };
    else if (path === '/api/dashboard/breakdown') body = { items: [{ groupKey: 'brand', groupLabel: '清研', finalizedCount: 24, effectiveCount: 15, lowEffectiveCount: 6, invalidCount: 3, effectiveOutputRate: 87.5 }] };
    else if (path === '/api/v11/cases') body = { items: [{ evaluationId: 'case-1', videoId, title: videos[0].title, brand: '清研', platform: '抖音', videoType: 'product_card', creator: owner, comprehensiveRating: 'A', businessConclusion: 'effective', decisionSource: 'human', caseNote: '场景表达清晰，适合复用的内容组织方式。', caseMarkedAt: now, caseMarkedBy: { name: '内容负责人' } }] };
    else if (path === '/api/v11/benchmark-profiles') body = [{ id: 'benchmark-1', name: '商品卡 · 常规观察基准', version: 2, platform: '抖音', brand: '清研', videoType: 'product_card', primaryMetric: 'views', requiredMetrics: ['views'], minimumSampleValue: '1000', observationWindowDays: 7, status: 'approved', enabled: true, thresholds: [{ rating: 'A', value: '5000' }], guardRules: [] }];
    else if (path === '/api/admin/operations/overview') body = { activeUsers: 12, formalVideos: 36, trialVideos: 4, worker: 'healthy', jobs: [], observedAt: now };
    else if (path === '/api/admin/operations/dependencies') body = { api: 'alive', database: 'available', worker: { status: 'healthy', lastSeenAt: now }, ai: 'not_probed', storage: 'not_probed', resources: 'not_connected', backups: 'not_connected', certificates: 'not_connected', cloudBilling: 'not_connected' };
    return route.fulfill({ json: body });
  });
  return requests;
}

const checks = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const requests = await fixture(context, 'admin');
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  async function ready(path) { await page.goto(base + path); await page.locator('main h1').waitFor(); await page.getByRole('status').filter({ hasText: '正在加载视频' }).waitFor({ state: 'hidden' }); await page.waitForLoadState('networkidle'); }
  async function shot(name) { await page.screenshot({ path: resolve(output, name), fullPage: true }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: page overflow`); }
  await ready('/videos');
  assert.equal(await page.locator('input[name=month]').inputValue(), '');
  assert(!requests.filter(r => r.path === '/api/videos').at(-1).query.includes('month='));
  await shot('01-videos.png');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.waitForURL(/page=2/);
  await page.getByRole('button', { name: '卡片', exact: true }).click();
  await page.locator('.video-card-mode:visible').waitFor();
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await page.locator('input[name=search]').fill('秋季');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.waitForURL(/search=/);assert(new URL(page.url()).searchParams.get('page') === '1');
  await page.getByRole('button', { name: '清空全部', exact: true }).click();
  await page.waitForURL('**/videos?page=1');
  await page.getByText('更多筛选', { exact: true }).click();
  await page.locator('label').filter({ has: page.getByText('当前结果中的上传人', { exact: true }) }).locator('select').selectOption(other.id);
  assert.equal(await page.locator('input[name=creatorId]').inputValue(), other.id);
  await page.locator('input[name=creatorId]').fill('00000000-0000-4000-8000-999999999999');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.waitForURL(/creatorId=/);assert.equal(new URL(page.url()).searchParams.get('creatorId'), '00000000-0000-4000-8000-999999999999');
  checks.push('search/pagination/list-card/applied filters/creator quick and exact');

  await ready('/videos');
  await page.getByText('更多筛选', { exact: true }).click();
  const filters = { status: 'submitted', videoType: 'organic', platform: '小红书', contentRating: 'A', dataRating: 'B', comprehensiveRating: 'A', dateFrom: '2026-08-01', dateTo: '2026-10-31' };
  for (const [name, value] of Object.entries(filters)) {
    const control = page.locator(`[name="${name}"]`);
    if (await control.evaluate(el => el.tagName === 'SELECT')) await control.selectOption(value);
    else await control.fill(value);
  }
  const filteredRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/videos' && new URL(request.url()).searchParams.get('status') === 'submitted');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.waitForURL(/status=submitted/);
  const actualRequest = await filteredRequest;
  await page.waitForLoadState('networkidle');
  const applied = new URL(actualRequest.url()).searchParams;
  for (const [name, value] of Object.entries(filters)) {
    assert.equal(applied.get(name), value);
    assert.equal(await page.locator(`[name="${name}"]`).inputValue(), value);
  }
  checks.push('status/type/platform/content/data/comprehensive/date filters preserve URL/UI/API values');

  await ready('/videos/' + videoId); await page.getByTestId('v11-evaluation-panel').waitFor();
  await page.getByRole('tab', { name: '评估结果', exact: true }).waitFor();
  const actions = page.getByRole('region', { name: '当前可执行操作', exact: true });
  assert.equal(await actions.locator('li').count(), 2);
  assert((await actions.innerText()).includes('可补充运营/投放数据'));
  assert((await actions.innerText()).includes('可开始数据复盘'));
  assert.equal(await actions.getByRole('button').count(), 1, 'same-tab actions share navigation only');
  await shot('02-video-detail.png');
  const player = page.locator('.video-player-panel');
  const token = await player.evaluate(el => { el.dataset.lifecycleCheck = 'retained'; return el.dataset.lifecycleCheck; });
  const before = requests.length;
  for (const label of ['数据表现', '综合决策', '版本记录', '操作记录', '评估结果']) await page.getByRole('tab', { name: label, exact: true }).click();
  assert.equal(await player.getAttribute('data-lifecycle-check'), token);
  assert.equal(requests.length, before, 'tab grouping must not cause requests');
  await page.getByRole('tab', { name: '评估结果', exact: true }).press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: '数据表现', exact: true }).getAttribute('aria-selected'), 'true');
  checks.push('five tabs keyboard/player retained/no new requests');
  for (const [path, name] of [['/videos/new','03-upload.png'],['/dashboard','04-dashboard.png'],['/cases/excellent','05-cases.png'],['/settings/benchmarks','06-benchmark.png'],['/admin','07-admin.png']]) { await ready(path); await shot(name); }
  await ready('/dashboard'); assert((await page.locator('main').innerText()).includes('87.5%')); checks.push('dashboard server figures unchanged');
  for (const [width, shots] of [[1024,[['/videos','08-videos-1024.png'],['/videos/'+videoId,'09-detail-1024.png']]],[768,[['/videos','10-navigation-768.png'],['/videos/'+videoId,'11-detail-768.png']]],[390,[['/videos','13-videos-mobile.png'],['/videos/'+videoId,'14-detail-mobile.png']]]]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [path,name] of shots) { await ready(path); await shot(name); }
  }
  await ready('/videos');
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  assert.equal(await page.locator('#navigation-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('.app-content').evaluate(el => el.inert), true);
  await shot('12-mobile-menu.png');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#navigation-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('.app-content').evaluate(el => el.inert), false);
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await page.getByRole('link', { name: '上传视频', exact: true }).click();
  await page.waitForURL('**/videos/new');assert.equal(await page.locator('#navigation-toggle').getAttribute('aria-expanded'), 'false');
  checks.push('1440/1024/768/390 overflow/menu open/close/Escape/route close');
  assert.deepEqual(errors, []);
  await context.close();
  for (const [allowed, title, links] of [[['export_report'], '暂无可执行操作', 0], [['submit_result_metrics'], '下一步', 1], [['submit_result_metrics', 'execute_rule_engine'], '当前可执行操作', 2]]) {
    const c = await browser.newContext({ serviceWorkers: 'block' });
    const calls = await fixture(c, 'admin', allowed);
    const p = await c.newPage(); await p.goto(base + '/videos/' + videoId);
    const region = p.getByRole('region', { name: title, exact: true }); await region.waitFor();
    assert.equal(await region.getByRole('button').count(), links);
    for (const button of await region.getByRole('button').all()) await button.click();
    assert(calls.every(call => call.method === 'GET'), 'action summary navigation never submits business mutations');
    await c.close();
  }
  checks.push('zero/single/multiple allowedActions; same-tab dedupe/cross-tab navigation; no POST');
  for (const role of ['admin','content_owner','supervisor','director','operator','advertiser','visitor']) {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });await fixture(c,role);const p=await c.newPage();await p.goto(base+'/videos');await p.getByRole('heading',{name:'视频任务',exact:true}).waitFor();await p.getByRole('status').filter({hasText:'正在加载视频'}).waitFor({state:'hidden'});
    assert.equal(await p.locator('input[name=creatorId]').count(),role==='admin'?1:0);
    assert.equal(await p.getByRole('link',{name:'系统管理',exact:true}).count(),role==='admin'?1:0);
    if(role==='visitor') assert.equal(await p.getByRole('link',{name:'结果看板',exact:true}).count(),0);
    if(role!=='admin'){await p.goto(base+'/admin');await p.waitForURL('**/videos');}
    await c.close();checks.push('role '+role);
  }
  const result={ok:true,checks,viewports:[1440,1024,768,390],paidModelCalls:0,productionTouched:false};await writeFile(resolve(output,'ui2-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally { await browser.close(); }
