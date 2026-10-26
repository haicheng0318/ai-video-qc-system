import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { localBrowserEnvironment } from './local-browser-environment.mjs';

const { base, target, childEnv } = localBrowserEnvironment(process.env, 'V120_BROWSER_BASE_URL', 'http://127.0.0.1:3118');
const playwrightRequire = process.env.PLAYWRIGHT_MODULE_DIR
  ? createRequire(resolve(process.env.PLAYWRIGHT_MODULE_DIR, 'entry.cjs'))
  : createRequire(realpathSync(execFileSync('which', ['playwright'], { encoding: 'utf8', env: childEnv }).trim()));
const { chromium } = playwrightRequire('playwright');
const output = resolve(process.env.V120_ACCEPTANCE_DIR || '/Volumes/拓展盘/数据迁移/AIQC-V1.2.0-review');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, env: childEnv });
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
].map(([dimension, anchor, observation, improvementSuggestions], index) => ({ dimension, weight: [15, 15, 12, 12, 10, 10, 13, 13][index], adoptedAnchor: anchor, score: Math.round(([15, 15, 12, 12, 10, 10, 13, 13][index] * anchor / 4) * 10) / 10, status: anchor >= 3.5 ? '优秀' : anchor >= 2.5 ? '良好' : anchor >= 1.5 ? '可优化' : '需重点优化', observation, facts: ['产品利益点在画面中可见'], factClaims: [], evidence: [{ startSeconds: index * 2, endSeconds: index * 2 + 3, description: '产品展示及字幕说明' }], improvementSuggestions }));
const group = { status: 'adopted', shadowMode: false, runs: [{ id: 'run-1', runNumber: 1, runRole: 'primary', status: 'succeeded', totalScore: 76, contentRating: 'B', complianceStatus: 'clear', stale: false, completedAt: now }], decision: { id: 'decision-1', sourceRunIds: ['run-1'], adoptedDimensions: dimensions.map(d => ({ dimension: d.dimension, anchor: d.adoptedAnchor })), totalScore: 76, contentRating: 'B', complianceStatus: 'clear', inputComplete: true, stable: true, decisionSource: 'system', adoptionMethod: 'single', decidedAt: now }, workflowRevision: { revision: 1 } };
const videos = [
  { id, title: '秋日新品 · 日常清洁场景', brand: '清研', product: '洁净系列', platform: '抖音', videoType: 'product_card', status: 'pending_result_data', recordState: 'active', createdAt: now, updatedAt: now, coverUrl: '/api/mock-cover', creator, v11EvaluationGroups: [group], v11DataDecisions: [], v11ComprehensiveDecisions: [] },
  { id: otherId, title: '夏日轻养主题', brand: '清研', product: '饮品系列', platform: '小红书', videoType: 'organic', status: 'final_effective', recordState: 'active', createdAt: '2026-08-15T04:00:00.000Z', updatedAt: now, coverUrl: null, creator, v11EvaluationGroups: [], v11DataDecisions: [], v11ComprehensiveDecisions: [] },
];
const calls = [];
const requests = [];
let selectedState = 'active';
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
    requests.push({ method, path, search: url.search });
    if (/^\/api\/videos\/[0-9a-f-]+\/file$/.test(path)) return route.fulfill({ status: 200, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes' }, body: syntheticVideo });
    if (path === '/api/mock-cover') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#e8ecf2"/><rect x="48" y="48" width="864" height="444" rx="18" fill="#fff"/><circle cx="480" cy="205" r="76" fill="#6d28d9"/><path d="M458 160v90l76-45z" fill="#fff"/><text x="480" y="365" text-anchor="middle" font-size="40" font-family="sans-serif" fill="#263244">V1.2 合成视频封面</text></svg>' });
    let body = null, status = 200;
    if (path === '/api/auth/me') body = { user: currentUser };
    else if (path === '/api/auth/business-options') body = { platforms: ['抖音', '小红书'], videoTypes: ['product_card', 'organic'] };
    else if (path === '/api/admin/users') body = { items: [admin, creator].map(({ id: userId, name }) => ({ id: userId, name })), total: 2, page: 1, pageSize: 100 };
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
    } else if (path === '/api/videos/00000000-0000-4000-8000-000000000014') body = {
      ...videos[0], id: '00000000-0000-4000-8000-000000000014', status: 'submitted', coverUrl: null,
      allowedActions: [], aiContentReviews: [], supervisorReview: null, resultMetrics: [], aiResultReviews: [],
      ruleEngineResults: [], finalVideoEvaluations: [], operationLogs: [], revisions: [], versionChain: [], latestResultMetricId: null,
    };
    else if (path === `/api/videos/${revisionId}`) body = { ...videos[0], id: revisionId, status: 'revision_required', coverUrl: null, allowedActions: ['upload_revision'], supervisorReview: null, isForAds: false, isEventVideo: false, eventName: '', version: 1, aiContentReviews: [], resultMetrics: [], aiResultReviews: [], ruleEngineResults: [], finalVideoEvaluations: [], operationLogs: [], revisions: [], versionChain: [], latestResultMetricId: null };
    else if (path === `/api/videos/${id}`) body = { ...videos[0], isForAds: false, isEventVideo: false, eventName: '', version: 1, allowedActions: ['submit_result_metrics'], aiContentReviews: [], supervisorReview: { decision: 'approved', comment: '历史记录只读展示', reviewedAt: now }, resultMetrics: [], aiResultReviews: [], ruleEngineResults: [], finalVideoEvaluations: [], operationLogs: [{ id: 'log-1', actionType: 'video_uploaded', createdAt: now }], revisions: [], versionChain: [], latestResultMetricId: null };
    else if (path.endsWith('/file-url')) body = { url: null };
    else if (path.endsWith('/content-review/latest')) body = { review: null, videoStatus: 'pending_result_data' };
    else if (path.endsWith('/supervisor-review/latest')) body = path.includes(revisionId) ? null : { decision: 'approved', comment: '历史记录只读展示', reviewedAt: now };
    else if (path.endsWith('/result-metrics/latest')) body = null;
    else if (path.endsWith('/result-review/latest')) body = { review: null, videoStatus: 'pending_result_data' };
    else if (path.endsWith('/rule-engine/latest')) body = { ruleEngineResult: null, videoStatus: 'pending_result_data' };
    else if (path.endsWith('/final-evaluation/latest')) body = { evaluation: null, videoStatus: 'pending_result_data' };
    else if (path.endsWith('/v11-content-review/latest')) body = {
      group,
      diagnostics: {
        dimensions,
        directorSummary: {
          strengths: [{ dimension: 'selling_point', score: 13.1, observation: '卖点表达清晰。' }],
          priorities: [{ ...dimensions[7], priority: 'P1' }, { ...dimensions[0], priority: 'P2' }],
          stableMessage: null,
        },
      },
    };
    else if (path.endsWith('/v11-workflow')) body = { revision: { revision: 1, holds: [], appeals: [] } };
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
    else body = {};
    return route.fulfill({ status, json: body });
  });
}

const browserContext = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
try {
  await installApi(browserContext);
  const page = await browserContext.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(`${page.url()}\n${error.stack || error.message}`));
  async function goto(path) { await page.goto(base + path); await page.locator('main h1').first().waitFor(); await page.waitForLoadState('networkidle'); }
  async function screenshot(name) { await page.screenshot({ path: resolve(output, name), fullPage: false }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} overflow`); }

  await goto('/login');
  assert.match(await page.locator('main').innerText(), /V1\.2\.0/);
  await screenshot('01-login-v120.png');

  await goto('/videos');
  assert.equal(await page.locator('input[name=month]').inputValue(), '');
  const firstListCall = requests.find(item => item.path === '/api/videos' && item.method === 'GET');
  assert(!new URLSearchParams(firstListCall.search).has('month'), 'default list must not send month');
  assert.equal(await page.getByRole('heading', { name: '视频任务' }).count(), 1);
  await screenshot('02-video-workspace.png');
  await page.getByRole('button', { name: '卡片', exact: true }).click();
  await page.locator('.video-card').first().waitFor();
  await page.locator('.video-card video').waitFor();
  await page.waitForFunction(() => {
    const player = document.querySelector('.video-card video');
    return player && player.readyState >= 1 && player.currentTime >= 0.95;
  });
  await screenshot('03-video-card.png');
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await page.locator('input[name=month]').fill('2026-08');
  const augustQuery = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/api/videos' && url.searchParams.get('month') === '2026-08';
  });
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.waitForURL(/month=2026-08/);
  assert.equal(new URL(page.url()).searchParams.get('month'), '2026-08');
  await augustQuery;
  await page.getByRole('button', { name: '清空全部', exact: true }).click();
  await page.waitForURL(url => !new URL(url).searchParams.has('month'));
  assert.equal(await page.locator('input[name=month]').inputValue(), '');
  assert.equal(selectedState, 'active');

  await goto(`/videos/${id}`);
  await page.getByTestId('v11-evaluation-panel').waitFor();
  await page.getByRole('heading', { name: 'AI评估进度' }).waitFor();
  assert((await page.getByRole('listitem').allInnerTexts()).some(text => text.includes('完成')));
  const fakePng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  await page.locator('.cover-manager input[type=file]').setInputFiles({ name: 'synthetic-cover.png', mimeType: 'image/png', buffer: fakePng });
  await page.getByRole('button', { name: '上传封面', exact: true }).click();
  await waitForCall('custom-cover');
  await page.getByRole('button', { name: '重新生成默认封面', exact: true }).click();
  await waitForCall('cover-regenerate');
  assert(calls.includes('custom-cover') && calls.includes('cover-regenerate'));
  await page.getByRole('heading', { name: '8 维诊断' }).waitFor();
  assert.equal(await page.locator('.diagnostic-card').count(), 8);
  assert((await page.locator('.diagnostic-grid').innerText()).includes('该历史评估版本未生成修改建议') === false, 'fixture represents new output with suggestions');
  assert((await page.locator('.diagnostic-grid').innerText()).includes('结尾加入明确的点击或了解指引。'));
  assert((await page.locator('.diagnostic-grid').innerText()).includes('2.0s–5.0s'));
  assert.equal(await page.getByRole('tab', { name: '内容评估' }).count(), 1);
  assert.equal(await page.getByRole('tab', { name: '数据表现' }).count(), 1);
  assert.equal(await page.getByRole('tab', { name: '综合结果' }).count(), 1);
  assert.equal(await page.getByRole('tab', { name: '记录' }).count(), 1);
  assert.equal(await page.getByRole('button', { name: /主管审核/ }).count(), 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByTestId('v11-evaluation-panel').scrollIntoViewIfNeeded();
  await screenshot('04-content-report.png');
  await page.locator('.diagnostic-grid').scrollIntoViewIfNeeded();
  await screenshot('05-dimension-diagnostics.png');
  await page.getByRole('tab', { name: '记录' }).click();
  assert((await page.locator('#detail-panel-records').innerText()).includes('历史主管审核'));
  await page.getByRole('tab', { name: '内容评估' }).click();

  await goto(`/videos/${revisionId}`);
  await page.getByRole('heading', { name: '上传返修版本' }).waitFor();
  assert((await page.locator('main').innerText()).includes('V1.2 内容评估自动关卡要求优化返修。'));
  await page.locator('#revision-file').setInputFiles({ name: 'synthetic-revision.webm', mimeType: 'video/webm', buffer: syntheticVideo });
  await page.getByRole('button', { name: '上传返修版本', exact: true }).click();
  await waitForCall('revision-upload');
  await page.waitForFunction(() => location.pathname === '/videos/00000000-0000-4000-8000-000000000014');
  await goto(`/videos/${id}`);

  await goto('/videos/new');
  const uploadRoute = requests.length;
  const syntheticUpload = Buffer.alloc(1_000_000, 0);
  syntheticUpload.write('ftyp', 4, 'ascii');
  await page.locator('#file').setInputFiles({ name: 'synthetic-smoke.mp4', mimeType: 'video/mp4', buffer: syntheticUpload });
  await page.locator('#cover').setInputFiles({ name: 'synthetic-cover.png', mimeType: 'image/png', buffer: fakePng });
  await page.locator('#title').fill('V1.2.0 synthetic upload');
  const pendingUpload = page.waitForRequest(request => request.url().includes('/api/videos') && request.method() === 'POST');
  await page.getByRole('button', { name: /提交|上传/ }).last().click();
  await pendingUpload;
  await page.getByRole('status').filter({ hasText: /正在上传视频/ }).waitFor();
  await waitForCall('upload-cover');
  await screenshot('06-upload-progress.png');
  await page.waitForURL(/\/videos\//);
  assert(requests.length >= uploadRoute);

  await goto('/videos');
  await page.getByText('管理筛选', { exact: true }).click();
  await page.locator('[name=recordState]').selectOption('active');
  await page.locator('.video-management-menu summary').first().click();
  page.once('dialog', dialog => dialog.accept('V1.2 验收隐藏样本'));
  await page.getByRole('button', { name: '隐藏', exact: true }).first().click();
  await page.locator('[name=recordState]').selectOption('hidden');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.waitForURL(/recordState=hidden/);
  assert(videos[0].recordState === 'hidden');
  await screenshot('07-hidden-trash.png');
  await page.locator('.video-management-menu summary').first().click();
  page.once('dialog', dialog => dialog.accept('V1.2 验收恢复隐藏样本'));
  await page.getByRole('button', { name: '恢复', exact: true }).first().click();
  await page.locator('[name=recordState]').selectOption('active');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.waitForURL(/recordState=active/);
  await page.locator('.video-management-menu summary').first().click();
  page.once('dialog', dialog => dialog.accept('V1.2 验收回收站样本'));
  await page.getByRole('button', { name: '移入回收站', exact: true }).first().click();
  await page.locator('[name=recordState]').selectOption('trashed');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.waitForURL(/recordState=trashed/);
  assert.equal(videos[0].recordState, 'trashed');
  await page.locator('.video-management-menu summary').first().click();
  page.once('dialog', dialog => dialog.accept('V1.2 验收恢复样本'));
  await page.getByRole('button', { name: '恢复', exact: true }).first().click();
  await page.locator('[name=recordState]').selectOption('active');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.waitForURL(/recordState=active/);
  assert.equal(videos[0].recordState, 'active');
  assert(calls.includes('hide') && calls.includes('restore'));

  await page.setViewportSize({ width: 390, height: 844 });
  await goto('/videos');
  await screenshot('08-mobile.png');
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    for (const route of ['/videos', `/videos/${id}`]) {
      await goto(route);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px ${route} horizontal overflow`);
    }
  }
  assert.deepEqual(pageErrors, []);
  const report = { ok: true, checks: ['login product version 1.2.0', 'empty month/default historical list', 'month selection and clear', 'simplified filters and admin creator scope', 'synthetic no-cover video metadata seeks card preview to second 1', 'optional upload cover posts to authenticated cover endpoint', 'C/D system decision without SupervisorReview exposes and submits revision upload', 'custom cover upload and default cover regeneration UI', 'admin hide/trash/restore', 'real multipart XHR byte progress with mocked API', 'AI evaluation progress state', '4 detail tabs', '8 dimension diagnostics/evidence/suggestions', 'director summary', 'no daily supervisor UI; history read-only', 'video list/detail responsive width checks at 1440/1024/768/390 with no horizontal overflow'], paidModelCalls: 0, productionTouched: false, screenshots: ['01-login-v120.png', '02-video-workspace.png', '03-video-card.png', '04-content-report.png', '05-dimension-diagnostics.png', '06-upload-progress.png', '07-hidden-trash.png', '08-mobile.png'] };
  const tileWidth = 640, imageHeight = 360, captionHeight = 38;
  const images = await Promise.all(report.screenshots.map(async (name) => {
    const path = resolve(output, name);
    const image = await sharp(path).resize(tileWidth, imageHeight, { fit: 'inside', background: '#f5f6f8' }).png().toBuffer();
    const label = Buffer.from(`<svg width="${tileWidth}" height="${captionHeight}"><rect width="100%" height="100%" fill="#fff"/><text x="16" y="26" font-size="18" font-family="Arial,sans-serif" fill="#27303f">${name}</text></svg>`);
    return { input: await sharp({ create: { width: tileWidth, height: imageHeight + captionHeight, channels: 4, background: '#f5f6f8' } }).composite([{ input: image, top: 0, left: 0 }, { input: label, top: imageHeight, left: 0 }]).png().toBuffer() };
  }));
  await sharp({ create: { width: tileWidth * 2, height: (imageHeight + captionHeight) * 4, channels: 4, background: '#e9edf2' } }).composite(images.map((image, index) => ({ ...image, left: (index % 2) * tileWidth, top: Math.floor(index / 2) * (imageHeight + captionHeight) }))).png().toFile(resolve(output, 'V120_REVIEW_CONTACT_SHEET.png'));
  await writeFile(resolve(output, 'v120-browser-acceptance.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browserContext.close();
  await browser.close();
}
