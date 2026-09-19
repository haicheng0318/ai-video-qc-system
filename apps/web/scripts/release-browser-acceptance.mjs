import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { browserOutput } from './local-browser-output.mjs';
import { localBrowserEnvironment } from './local-browser-environment.mjs';

const { base, target, childEnv } = localBrowserEnvironment(process.env, 'RELEASE_BROWSER_BASE_URL', 'http://127.0.0.1:3107');
const executable = execFileSync('which', ['playwright'], { encoding: 'utf8', env: childEnv }).trim();
const { chromium } = createRequire(realpathSync(executable))('playwright');
const output = browserOutput('release'); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, env: childEnv });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const videoA = '00000000-0000-4000-8000-000000000001', videoB = '00000000-0000-4000-8000-000000000002';
  const user = { id: 'local-director', name: '本地发布验收', account: 'fixture', role: 'content_owner' };
  const now = '2026-09-10T06:00:00.000Z';
  let state = 'submitted', polls = 0, triggers = 0, signatures = 0, jobDone = false;
  let media;
  const review = () => state === 'submitted' ? null : { id: 'review-a', status: jobDone ? 'succeeded' : 'running', modelProvider: 'fixture', modelName: 'fixture',
    contentSummary: '弱网恢复后的任务 A 内容结果', contentGrade: jobDone ? 'A' : null, totalScore: jobDone ? 85 : null,
    isPublishableRecommendation: true, scores: [], mainProblems: [], revisionSuggestions: [], complianceRisks: [], usableScenarios: [], createdAt: now };
  await context.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (['data:', 'blob:', 'about:'].includes(u.protocol)) return route.continue();
    if (u.origin !== target.origin) return route.abort('blockedbyclient');
    if (u.pathname === '/local-fixture.webm') {
      const range = route.request().headers().range;
      const start = range?.match(/^bytes=(\d+)-/) ? Number(RegExp.$1) : 0;
      return route.fulfill({ status: range ? 206 : 200, contentType: 'video/webm', body: media.subarray(start),
        headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${media.length - 1}/${media.length}` } : {}) } });
    }
    if (!u.pathname.startsWith('/api/')) return route.continue();
    let body = {};
    if (u.pathname === '/api/auth/me') body = { user };
    else if (u.pathname === '/api/auth/quotas') body = { items: [] };
    else if (u.pathname === `/api/videos/${videoA}` || u.pathname === `/api/videos/${videoB}`) {
      const isB = u.pathname.endsWith(videoB);
      body = { id: isB ? videoB : videoA, title: isB ? '视频 B：独立结果' : '发布验收：弱网与播放器', status: isB ? 'submitted' : state,
        videoType: 'organic', isForAds: false, isTrial: false, createdAt: now, updatedAt: now, creator: user,
        operationLogs: [], revisions: [], versionChain: [], allowedActions: state === 'submitted' ? ['trigger_content_review', 'export_report'] : ['submit_supervisor_review', 'export_report'] };
    } else if (u.pathname.endsWith('/file-url')) body = { url: `${base}/local-fixture.webm?generation=${++signatures}` };
    else if (u.pathname.endsWith('/content-review') && route.request().method() === 'POST') {
      triggers++; state = 'ai_content_reviewing'; body = { reviewId: 'review-a', jobId: 'job-a', status: 'running', videoStatus: state };
    } else if (u.pathname === '/api/evaluation-jobs/job-a') {
      polls++;
      if (polls <= 2) return route.abort('internetdisconnected');
      state = 'pending_supervisor_review'; jobDone = true; body = { id: 'job-a', stage: 'content', status: 'succeeded', reviewId: 'review-a' };
    } else if (u.pathname.includes('/content-reviews/')) {
      polls++;
      if (polls <= 2) return route.abort('internetdisconnected');
      state = 'pending_supervisor_review'; jobDone = true;
      body = { review: review(), videoStatus: state };
    } else if (u.pathname.endsWith('/content-review/latest')) body = { review: u.pathname.includes(videoB) ? null : review(), videoStatus: state };
    else if (u.pathname.endsWith('/supervisor-review/latest') || u.pathname.endsWith('/result-metrics/latest')) body = null;
    else if (u.pathname.endsWith('/result-review/latest')) body = { review: null, videoStatus: state };
    else if (u.pathname.endsWith('/rule-engine/latest')) body = { ruleEngineResult: null, videoStatus: state };
    else if (u.pathname.endsWith('/final-evaluation/latest')) body = { evaluation: null, videoStatus: state };
    else if (u.pathname.includes('/history')) body = { items: [], nextCursor: null };
    else throw Error(`Unexpected fixture request: ${route.request().method()} ${u.pathname}`);
    return route.fulfill({ json: body });
  });
  await page.goto(`${base}/login`);
  // Real playable media generated solely for this browser fixture.
  const encoded = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 320;
    const ctx = canvas.getContext('2d'); const stream = canvas.captureStream(12);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' }); const chunks = [];
    const done = new Promise(resolve => {
      recorder.ondataavailable = event => chunks.push(event.data);
      recorder.onstop = async () => resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())));
    });
    recorder.start(); let frame = 0;
    const timer = setInterval(() => { ctx.fillStyle = frame++ % 2 ? '#7964b5' : '#c2b5e8'; ctx.fillRect(0, 0, 180, 320); }, 80);
    await new Promise(resolve => setTimeout(resolve, 1800)); recorder.stop(); clearInterval(timer); stream.getTracks().forEach(track => track.stop());
    return done;
  });
  media = Buffer.from(encoded);
  await page.goto(`${base}/videos/${videoA}`);
  await page.locator('video').waitFor();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
  await page.locator('video').evaluate(async video => { video.muted = true; await video.play(); });
  await page.waitForFunction(() => document.querySelector('video').currentTime >= 0.2);
  await page.locator('video').evaluate(video => video.pause());
  await page.evaluate(() => { window.__task5Player = document.querySelector('video'); window.__task5Player.currentTime = 0.5; });
  await page.getByRole('button', { name: '触发内容评估', exact: true }).click();
  await page.getByText('弱网恢复后的任务 A 内容结果').waitFor({ timeout: 25000 });
  assert.equal(triggers, 1, 'network recovery must never issue another paid-trigger POST');
  assert.equal(polls, 3);
  assert.equal(await page.evaluate(() => window.__task5Player === document.querySelector('video')), true, 'polling must retain player DOM');
  assert.ok(await page.locator('video').evaluate(video => video.currentTime) >= 0.4);

  await page.getByRole('tab', { name: '主管审核', exact: true }).click();
  await page.locator('#supervisor-comment').fill('尚未保存的本地主管意见');
  await page.getByRole('tab', { name: '内容评估', exact: true }).click();
  const oldSignatures = signatures;
  // The transport TTL is tested with real local HTTP by release-acceptance.integration.spec.ts.
  // This event isolates the mounted player's error/reload contract while retaining currentTime.
  await page.locator('video').evaluate(video => video.dispatchEvent(new Event('error')));
  await page.waitForFunction(expected => document.querySelector('video')?.src.includes(`generation=${expected}`), oldSignatures + 1);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1 && document.querySelector('video').currentTime >= 0.4);
  await page.locator('video').evaluate(async video => { video.muted = true; await video.play(); });
  await page.waitForFunction(() => document.querySelector('video').currentTime >= 0.65);
  await page.locator('video').evaluate(video => video.pause());
  assert.equal(signatures, oldSignatures + 1, 'one media error performs one authorized URL renewal');
  await page.getByRole('tab', { name: '主管审核', exact: true }).click();
  assert.equal(await page.locator('#supervisor-comment').inputValue(), '尚未保存的本地主管意见');
  assert.equal(await page.evaluate(() => window.__task5Player === document.querySelector('video')), true);
  await page.screenshot({ path: resolve(output, 'desktop-player-draft.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: resolve(output, 'mobile-player-draft.png'), fullPage: true });
  page.once('dialog', dialog => dialog.accept()); await page.goto(`${base}/videos/${videoB}`);
  await page.getByRole('heading', { name: '视频 B：独立结果', exact: true }).waitFor();
  assert.equal(await page.getByText('弱网恢复后的任务 A 内容结果').count(), 0);
  assert.deepEqual(errors, []);
  const summary = { ok: true, browser: await browser.version(), triggers, polls, mediaBytes: media.length,
    tested: ['real decoded playback advances before and after renewal', 'two network failures with read-only recovery', 'same player across polling/tabs',
      'draft retained', 'one URL renewal after injected media error', 'desktop/mobile layout', 'video B isolation'],
    scope: 'local built UI with API/object fixtures; media error event is injected, no real COS or paid model' };
  await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} finally { await browser.close(); }
