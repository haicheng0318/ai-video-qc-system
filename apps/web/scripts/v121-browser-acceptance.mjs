import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { localBrowserEnvironment } from './local-browser-environment.mjs';

const { base, target, childEnv } = localBrowserEnvironment(process.env, 'V121_BROWSER_BASE_URL', 'http://127.0.0.1:3121');
const playwrightRequire = process.env.PLAYWRIGHT_MODULE_DIR
  ? createRequire(resolve(process.env.PLAYWRIGHT_MODULE_DIR, 'entry.cjs'))
  : createRequire(realpathSync(execFileSync('which', ['playwright'], { encoding: 'utf8', env: childEnv }).trim()));
const { chromium } = playwrightRequire('playwright');
const output = resolve(process.env.V121_ACCEPTANCE_DIR || '/tmp/aiqc-v121-acceptance');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE, env: childEnv });
const mediaPage = await browser.newPage();
const syntheticVideo = Buffer.from(await mediaPage.evaluate(async () => {
  const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
  const context = canvas.getContext('2d');
  const stream = canvas.captureStream(12);
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
  const chunks = [];
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  recorder.start();
  const started = performance.now();
  const draw = now => { context.fillStyle = `hsl(${Math.floor((now - started) / 12) % 360} 70% 55%)`; context.fillRect(0, 0, canvas.width, canvas.height); if (now - started < 1900) requestAnimationFrame(draw); else recorder.stop(); };
  requestAnimationFrame(draw);
  await new Promise(resolve => { recorder.onstop = resolve; });
  stream.getTracks().forEach(track => track.stop());
  return Array.from(new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()));
}));
await mediaPage.close();
assert(syntheticVideo.length > 0, 'browser generated a local synthetic WebM clip');
if (process.env.V120_SYNTHETIC_VIDEO_OUT) await writeFile(resolve(process.env.V120_SYNTHETIC_VIDEO_OUT), syntheticVideo);
const admin = { id: '00000000-0000-4000-8000-000000000001', name: '林予安', account: 'admin', role: 'admin' };
const creator = { id: '00000000-0000-4000-8000-000000000002', name: '陈思远', account: 'creator', role: 'director' };
const id = '00000000-0000-4000-8000-000000000011';
const otherId = '00000000-0000-4000-8000-000000000012';
const revisionId = '00000000-0000-4000-8000-000000000013';
const now = '2026-10-20T02:30:00.000Z';
const dimensions = [
  ['opening_hook', 2.5, '开场展示了产品，但核心利益点出现较晚。', ['前3秒说明主要利益点。']],
  ['selling_point', 3.5, '卖点表达清晰。', []],
  ['structure', 3, '结构完整，转场略快。', ['增加段落间的过渡。']],
  ['visual_quality', 3.5, '画面主体清晰。', []],
  ['pacing', 3, '节奏总体顺畅。', []],
  ['subtitle_audio', 3, '字幕清楚，口播音量稳定。', []],
  ['platform_fit', 3.5, '画幅适配平台。', []],
  ['action_logic', 2, '结尾没有清晰的下一步行动提示。', ['结尾加入明确的点击或了解指引。']],
].map(([dimension, anchor, observation, improvementSuggestions], index) => ({ dimension, representativeRunId: 'run-1', weight: [20, 20, 15, 15, 10, 10, 5, 5][index], adoptedAnchor: anchor, score: Math.round(([20, 20, 15, 15, 10, 10, 5, 5][index] * anchor / 4) * 10) / 10, status: anchor >= 3.5 ? '优秀' : anchor >= 2.5 ? '良好' : anchor >= 1.5 ? '可优化' : '需重点优化', observation, facts: ['产品利益点在画面中可见'], factClaims: [], evidence: [{ startSeconds: 0, endSeconds: 1, description: '产品展示及字幕说明' }], improvementSuggestions }));
const group = { id: 'group-1', videoId: id, inputRevision: { factClaimVersion: null }, status: 'adopted', shadowMode: false, runs: [{ id: 'run-1', runNumber: 1, runRole: 'primary', status: 'succeeded', totalScore: 76.3, contentRating: 'B', complianceStatus: 'clear', stale: false, completedAt: now, modelProvider: 'fixture', modelName: 'never-called', promptVersion: 'fixture', schemaVersion: 'fixture', rubricVersion: 'fixture', factClaimVersion: null, structuredOutput: null }], decision: { id: 'decision-1', sourceRunIds: ['run-1'], adoptedDimensions: dimensions.map(d => ({ dimension: d.dimension, anchor: d.adoptedAnchor })), totalScore: 76.3, contentRating: 'B', complianceStatus: 'clear', inputComplete: true, stable: true, decisionSource: 'system', adoptionMethod: 'single', decidedAt: now }, workflowRevision: { revision: 1 } };
const videos = [
  { id, title: '秋日新品 · 日常清洁场景', brand: '清研', product: '洁净系列', platform: '抖音', videoType: 'product_card', status: 'pending_result_data', recordState: 'active', createdAt: now, updatedAt: now, coverUrl: '/api/mock-cover', creator, v11EvaluationGroups: [group], v11DataDecisions: [], v11ComprehensiveDecisions: [] },
  { id: otherId, title: '夏日轻养主题', brand: '清研', product: '饮品系列', platform: '小红书', videoType: 'organic', status: 'final_effective', recordState: 'active', createdAt: '2026-08-15T04:00:00.000Z', updatedAt: now, coverUrl: null, creator, v11EvaluationGroups: [], v11DataDecisions: [], v11ComprehensiveDecisions: [] },
];
const calls = [];
const requests = [];
let selectedState = 'active';
let diagnosticScenario = 'normal';
async function waitForCall(name) {
  for (let attempt = 0; attempt < 40 && !calls.includes(name); attempt += 1) await new Promise(resolve => setTimeout(resolve, 50));
  assert(calls.includes(name), `expected mocked API call: ${name}`);
}

async function installApi(context, role = 'admin') {
  const currentUser = role === 'admin' ? admin : creator;
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== target.origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const method = request.method(), path = url.pathname;
    const scopedVideoId = path.match(/^\/api\/(?:v11\/)?videos\/([0-9a-f-]+)(?:\/|$)/)?.[1];
    requests.push({ method, path, search: url.search });
    if (/^\/api\/videos\/[0-9a-f-]+\/file$/.test(path)) return route.fulfill({ status: 200, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes' }, body: syntheticVideo });
    if (path === '/api/mock-cover') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#e8ecf2"/><rect x="48" y="48" width="864" height="444" rx="18" fill="#fff"/><circle cx="480" cy="205" r="76" fill="#6d28d9"/><path d="M458 160v90l76-45z" fill="#fff"/><text x="480" y="365" text-anchor="middle" font-size="40" font-family="sans-serif" fill="#263244">V1.2 合成视频封面</text></svg>' });
    let body = null, status = 200;
    if (path === '/api/auth/me') body = { user: currentUser };
    else if (path === '/api/auth/business-options') body = { platforms: ['抖音', '小红书'], videoTypes: ['product_card', 'organic'] };
    else if (path === '/api/admin/users') body = { items: [admin, creator].map(user => ({ ...user, status: 'active', expiresAt: null })), total: 2, page: 1, pageSize: 100 };
    else if (path === `/api/admin/users/${creator.id}`) body = { user: { ...creator, status: 'active', mustChangePassword: false, createdAt: now } };
    else if (path.endsWith('/sessions')) body = { items: [] };
    else if (path.endsWith('/quotas')) body = { quotas: [] };
    else if (path === '/api/videos' && method === 'GET') {
      const query = url.searchParams;
      const state = query.get('recordState') || 'active'; selectedState = state;
      const rows = videos.filter(video => (role === 'admin' || video.creator.id === currentUser.id) && video.recordState === state && (!query.get('month') || video.createdAt.slice(0, 7) === query.get('month')) && (!query.get('search') || video.title.includes(query.get('search'))) && (!query.get('creatorId') || video.creator.id === query.get('creatorId')) && (!query.get('businessStatus') || (query.get('businessStatus') === 'completed' ? video.status.startsWith('final_') : query.get('businessStatus') === 'waiting_data' ? ['pending_result_data', 'pending_data'].includes(video.status) : true)) && (!query.get('videoType') || video.videoType === query.get('videoType')));
      body = { items: rows, total: rows.length, page: 1, pageSize: 20 };
    } else if (path === '/api/videos' && method === 'POST') {
      calls.push('video-upload');
      await new Promise(resolve => setTimeout(resolve, 450));
      body = { id: '00000000-0000-4000-8000-000000000099', coverGenerationFailed: false };
    } else if (path === `/api/videos/${revisionId}/revisions` && method === 'POST') {
      calls.push('revision-upload');
      body = { id: '00000000-0000-4000-8000-000000000014' };
    } else if (['/api/videos/00000000-0000-4000-8000-000000000014', '/api/videos/00000000-0000-4000-8000-000000000099'].includes(path)) body = {
      ...videos[0], id: path.split('/').at(-1), status: 'submitted', coverUrl: null, v11EvaluationGroups: [],
      allowedActions: [], aiContentReviews: [], supervisorReview: null, resultMetrics: [], aiResultReviews: [],
      ruleEngineResults: [], finalVideoEvaluations: [], operationLogs: [], revisions: [], versionChain: [], latestResultMetricId: null,
    };
    else if (path === `/api/videos/${revisionId}`) body = { ...videos[0], id: revisionId, status: 'revision_required', v11EvaluationGroups: [], coverUrl: null, allowedActions: ['upload_revision'], supervisorReview: null, isForAds: false, isEventVideo: false, eventName: '', version: 1, aiContentReviews: [], resultMetrics: [], aiResultReviews: [], ruleEngineResults: [], finalVideoEvaluations: [], operationLogs: [], revisions: [], versionChain: [], latestResultMetricId: null };
    else if (path === `/api/videos/${id}`) body = { ...videos[0], isForAds: false, isEventVideo: false, eventName: '', version: 1, allowedActions: ['submit_result_metrics'], aiContentReviews: [], supervisorReview: { decision: 'approved', comment: '历史记录只读展示', reviewedAt: now }, resultMetrics: [], aiResultReviews: [], ruleEngineResults: [], finalVideoEvaluations: [], operationLogs: [{ id: 'log-1', actionType: 'video_uploaded', createdAt: now }], revisions: [], versionChain: [{ id, title: videos[0].title, status: videos[0].status, version: 1 }, { id: otherId, title: videos[1].title, status: videos[1].status, version: 2 }], latestResultMetricId: null };
    else if (path === `/api/videos/${otherId}`) body = { ...videos[1], version: 1, allowedActions: [], aiContentReviews: [], supervisorReview: null, resultMetrics: [], aiResultReviews: [], ruleEngineResults: [], finalVideoEvaluations: [], operationLogs: [], revisions: [], versionChain: [] };
    else if (path.endsWith('/file-url')) body = { url: null };
    else if (path.endsWith('/content-review/latest')) body = { review: null, videoStatus: 'pending_result_data' };
    else if (path.endsWith('/supervisor-review/latest')) body = scopedVideoId === id ? { decision: 'approved', comment: '历史记录只读展示', reviewedAt: now } : null;
    else if (path.endsWith('/result-metrics/latest')) body = null;
    else if (path.endsWith('/result-review/latest')) body = { review: null, videoStatus: 'pending_result_data' };
    else if (path.endsWith('/rule-engine/latest')) body = { ruleEngineResult: null, videoStatus: 'pending_result_data' };
    else if (path.endsWith('/final-evaluation/latest')) body = { evaluation: null, videoStatus: 'pending_result_data' };
    else if (path.endsWith('/v11-content-review/latest')) body = {
      shadowMode: false,
      group: scopedVideoId === id ? structuredClone(group) : null,
      diagnostics: {
        dimensions,
        directorSummary: {
          strengths: [{ dimension: 'selling_point', score: 17.5, observation: '卖点表达清晰。' }],
          priorities: [{ ...dimensions[7], priority: 'P1' }, { ...dimensions[0], priority: 'P2' }],
          stableMessage: null,
        },
      },
    };
    else if (path.endsWith('/v11-workflow')) body = { revision: [id, revisionId].includes(scopedVideoId) ? { videoId: scopedVideoId, revision: 1, holds: [], appeals: [] } : null };
    else if (path.endsWith('/ratings/latest')) body = { data: null, comprehensive: null };
    else if (path.endsWith('/history')) body = { items: [], nextCursor: null };
    else if (path.endsWith('/cover/regenerate') && method === 'POST') { calls.push('cover-regenerate'); body = { success: true }; }
    else if (path.endsWith('/cover') && method === 'POST') { calls.push(path.includes('00000000-0000-4000-8000-000000000099') ? 'upload-cover' : 'custom-cover'); body = { success: true }; }
    else if (/\/(hide|trash|restore)$/.test(path) && method === 'POST') {
      calls.push(path.split('/').at(-1));
      const video = videos.find(item => path.startsWith(`/api/videos/${item.id}/`));
      if (video) video.recordState = path.endsWith('/hide') ? 'hidden' : path.endsWith('/trash') ? 'trashed' : 'active';
      body = { success: true };
    } else if (path.includes('/cover')) body = { success: true };
    else if (path === '/api/auth/quotas') body = { quotas: [], expiresAt: null };
    else if (path === '/api/dashboard/summary') body = { finalizedCount: 24, finalEffectiveCount: 15, finalLowEffectiveCount: 6, finalInvalidCount: 3, effectiveOutputCount: 21, effectiveOutputRate: 87.5, performanceEligibleCount: 15, excellentCaseCount: 8, negativeCaseCount: 3, manualAdjustedCount: 2, pipeline: { pendingDataCount: 4, pendingFinalEvaluationCount: 1, finalEvaluationFailedCount: 0, pendingFinalConfirmationCount: 2 } };
    else if (path === '/api/dashboard/trend') body = { items: [{ bucket: '2026-10-12', finalizedCount: 8 }] };
    else if (path === '/api/dashboard/breakdown') body = { items: [{ groupKey: 'brand', groupLabel: '清研', finalizedCount: 24, effectiveCount: 15, lowEffectiveCount: 6, invalidCount: 3, effectiveOutputRate: 87.5 }] };
    else if (path === '/api/v11/benchmark-profiles') body = [{ id: 'benchmark-1', name: '商品卡 · 日常观察基准', version: 2, platform: '抖音', brand: '清研', videoType: 'product_card', primaryMetric: 'views', requiredMetrics: ['views'], minimumSampleValue: '1000', observationWindowDays: 7, status: 'approved', enabled: true, thresholds: [{ rating: 'A', value: '5000' }], guardRules: [] }];
    else if (path === '/api/v11/cases') { const negative = url.searchParams.get('type') === 'negative'; body = { items: [{ evaluationId: 'case-1', videoId: id, title: videos[0].title, brand: '清研', platform: '抖音', videoType: 'product_card', creator, comprehensiveRating: negative ? 'D' : 'A', businessConclusion: negative ? 'invalid' : 'effective', decisionSource: 'human', caseNote: negative ? '内容与数据均未达标，经确认作为反面案例复盘。' : '场景表达清晰，适合复用的内容组织方式。', caseMarkedAt: now, caseMarkedBy: { name: '内容负责人' } }] }; }
    else if (path === '/api/platform-benchmarks' || path.includes('/cases')) body = { items: [], nextCursor: null };
    else if (path === '/api/admin/roles') body = { items: [{ role: 'admin', capabilities: { ownVideo: true, allVideos: true, admin: true } }, { role: 'director', capabilities: { ownVideo: true, allVideos: false, admin: false } }] };
    else if (path === '/api/admin/operations/overview') body = { activeUsers: 12, formalVideos: 36, trialVideos: 4, jobs: [], observedAt: now };
    else if (path === '/api/admin/operations/dependencies') body = { api: 'alive', database: 'available', worker: { status: 'healthy', lastSeenAt: now }, ai: 'not_probed', storage: 'not_probed' };
    else body = {};
    if (path.endsWith('/v11-content-review/latest')) {
      body = structuredClone(body);
      if (!body.group) body.diagnostics = null;
      if (role !== 'admin' && body.group) {
        delete body.group.inputRevision;
        for (const run of body.group.runs) for (const field of ['modelProvider', 'modelName', 'promptVersion', 'schemaVersion', 'rubricVersion', 'factClaimVersion', 'structuredOutput']) delete run[field];
      }
      if (scopedVideoId === id && diagnosticScenario === 'error') { status = 503; body = { message: 'Fixture content endpoint unavailable' }; }
      else if (scopedVideoId !== id) body.diagnostics = null;
      else if (diagnosticScenario === 'missing') { body.group.decision = null; body.diagnostics = null; }
      else if (diagnosticScenario === 'unknown') {
        body.group.decision.totalScore = null; body.group.decision.contentRating = null; body.group.decision.inputComplete = false;
        Object.assign(body.diagnostics.dimensions[0], { adoptedAnchor: null, score: null, status: '无法判断' });
      }
      else if (diagnosticScenario === 'shadow') body.group.shadowMode = body.shadowMode = true;
      else if (diagnosticScenario === 'pilot') body.group.pilotRun = true;
      else if (diagnosticScenario === 'compliance') body.group.decision.complianceStatus = 'suspected';
      else if (diagnosticScenario === 'revision') body.group.decision.contentRating = 'C';
      else if (diagnosticScenario === 'legacy') {
        for (const dimension of body.diagnostics.dimensions) dimension.improvementSuggestions = null;
      }
    }
    if (path.endsWith('/v11-workflow') && scopedVideoId === id && ['hold', 'appeal'].includes(diagnosticScenario)) {
      body.revision[diagnosticScenario === 'hold' ? 'holds' : 'appeals'] = [{ id: 'blocking-fixture', reason: '当前结果需要处理', holdType: 'manual' }];
    }
    return route.fulfill({ status, json: body });
  });
}

const checks = [], screenshots = [], errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
try {
  await installApi(context);
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  async function goto(path) {
    await page.goto(base + path); await page.locator('main h1').first().waitFor(); await page.waitForLoadState('networkidle');
    if (path === `/videos/${id}`) await page.locator('video').first().evaluate(async video => { video.muted = true; await video.play(); video.pause(); });
  }
  async function shot(name) {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: horizontal overflow`);
    await page.screenshot({ path: resolve(output, name), fullPage: false, animations: 'disabled' }); screenshots.push(name);
  }
  await goto('/login');
  assert.match(await page.title(), /1\.2\.1/);
  assert.equal(await page.locator('nextjs-portal button').evaluateAll(es => es.filter(e => e.getClientRects().length > 0).length), 0, 'development tooling must not cover application controls');
  await page.getByLabel('界面主题', { exact: true }).selectOption('dark');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await shot('01-login-dark.png');
  await page.getByLabel('界面主题', { exact: true }).selectOption('light');
  await shot('02-login-light.png');
  await goto('/videos');
  assert.equal(await page.locator('input[name=month]').inputValue(), '');
  assert(!requests.find(r => r.path === '/api/videos').search.includes('month='));
  await page.locator('input[name=month]').fill('2026-08');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.waitForURL(/month=2026-08/);
  await page.getByRole('button', { name: '清空全部', exact: true }).click();
  await page.waitForURL(u => !u.searchParams.has('month'));
  assert.equal(await page.locator('input[name=month]').inputValue(), '');
  checks.push('URL month selection/clear and no implicit month');
  await shot('03-videos-light.png');
  await page.getByLabel('界面主题', { exact: true }).selectOption('dark');
  await page.reload(); await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await shot('04-videos-dark.png');
  const sibling = await context.newPage(); await sibling.goto(base + '/login');
  await page.getByLabel('界面主题', { exact: true }).selectOption('light');
  await sibling.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await sibling.close();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByLabel('界面主题', { exact: true }).selectOption('system');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  checks.push('theme persistence, cross-tab synchronization, system change');
  await goto(`/videos/${id}`);
  await page.getByRole('heading', { name: '8 维诊断' }).waitFor();
  assert.equal(await page.locator('.diagnostic-card').count(), 8);
  assert.equal(await page.locator('.dimension-overview > div').count(), 8);
  assert.equal(await page.locator('.diagnostic-card[open]').count(), 3);
  await page.getByTestId('v11-evaluation-panel').scrollIntoViewIfNeeded();
  await shot('05-admin-detail-light.png');
  await page.locator('.admin-technical-view > summary').click();
  assert(await page.locator('.admin-technical-view').isVisible());
  await page.getByRole('tab', { name: '记录', exact: true }).click();
  assert(await page.locator('#detail-panel-records details').count() > 0);
  await page.getByRole('tab', { name: '内容评估', exact: true }).click();
  checks.push('8 dimensions, suggested disclosures, evidence retained, history tab, admin audit');
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('界面主题', { exact: true }).selectOption(theme);
    for (const [route, name] of [['/dashboard', 'dashboard'], ['/videos/new', 'upload'], ['/cases/excellent', 'cases'], ['/cases/negative', 'negative-cases'], ['/settings/benchmarks', 'benchmarks'], ['/admin', 'operations'], ['/admin/operations', 'runtime'], ['/admin/users', 'users'], [`/admin/users/${creator.id}`, 'user-detail'], ['/admin/roles', 'roles']]) {
      await goto(route);
      if (route === '/cases/negative') {
        assert.match(await page.locator('.case-card').innerText(), /反面/);
        assert.match(await page.locator('.case-grades').innerText(), /D[\s\S]*无效/);
        assert.doesNotMatch(await page.locator('.case-grades').innerText(), /effective/);
      }
      if (route === '/admin') assert.match(await page.locator('main').innerText(), /Product Version：V1\.2\.1/);
      await shot(`${name}-${theme}.png`);
    }
  }
  for (const width of [1440, 1024, 768, 390, 375]) {
    await page.setViewportSize({ width, height: width < 400 ? 812 : 960 });
    for (const [route, name] of [['/videos', 'videos'], [`/videos/${id}`, 'detail'], ['/videos/new', 'upload'], ['/admin/users', 'users'], [`/admin/users/${creator.id}`, 'user-detail']]) {
      await goto(route);
      if (width === 390 && await page.locator('.page-title > div').count()) assert.equal(await page.locator('.page-title > div').first().evaluate(e => getComputedStyle(e).flexBasis), 'auto', 'mobile heading must not reserve a desktop-height flex basis');
      await shot(`${name}-${width}.png`);
      if (width < 400 && route === '/admin/users') {
        const input = page.locator('#new-name');
        await input.scrollIntoViewIfNeeded();
        assert(await input.evaluate(e => { const r = e.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e; }), 'name input is not covered');
        await page.locator('button[type=submit]').last().scrollIntoViewIfNeeded();
        await shot(`users-bottom-${width}.png`);
      }
    }
  }
  await goto('/videos');
  await page.getByRole('button', { name: /打开导航|展开导航|菜单/ }).first().click();
  await page.locator('.sidebar-footer').scrollIntoViewIfNeeded();
  assert(await page.locator('.sidebar-footer button').evaluate(e => { const r = e.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e; }), 'account action remains reachable within scrolling drawer');
  await shot('mobile-menu.png');
  await page.keyboard.press('Escape');
  checks.push('1440/1024/768/390/375 responsive, unobscured name input and account actions, Escape navigation');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.video-card').count() ? await page.locator('.video-card').first().evaluate(e => getComputedStyle(e).animationName) : await page.locator('.app-shell').evaluate(e => getComputedStyle(e).animationName), 'none');
  checks.push('reduced motion disables animation; product version 1.2.1; negative cases D/invalid');
  const publicContext = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
  await installApi(publicContext, 'director');
  const publicPage = await publicContext.newPage();
  publicPage.on('pageerror', e => errors.push(e.message));
  await publicPage.goto(base + `/videos/${id}`); await publicPage.getByRole('heading', { name: '8 维诊断' }).waitFor();
  assert.equal(await publicPage.locator('.admin-technical-view').count(), 0);
  assert.equal(await publicPage.locator('.diagnostic-card').count(), 8);
  await publicPage.screenshot({ path: resolve(output, 'public-detail-light.png'), fullPage: false, animations: 'disabled' }); screenshots.push('public-detail-light.png');
  await publicPage.getByLabel('界面主题', { exact: true }).selectOption('dark');
  await publicPage.screenshot({ path: resolve(output, 'public-detail-dark.png'), fullPage: false, animations: 'disabled' }); screenshots.push('public-detail-dark.png');
  await publicContext.close();
  checks.push('public role retains business diagnostics without technical data');
  assert.deepEqual(errors, []);
  const report = { ok: true, checks, screenshots, paidModelCalls: 0, productionTouched: false, mockedApi: true };
  await writeFile(resolve(output, 'v121-browser-acceptance.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await context.close(); await browser.close(); }


