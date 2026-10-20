import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localBrowserEnvironment } from './local-browser-environment.mjs';

const { base, target, childEnv } = localBrowserEnvironment(process.env, 'VIDEO_MONTH_BROWSER_BASE_URL', 'http://127.0.0.1:3112');
const require = createRequire(import.meta.url);
const { chromium } = process.env.QC_PLAYWRIGHT_MODULE
  ? require(process.env.QC_PLAYWRIGHT_MODULE)
  : createRequire(realpathSync(execFileSync('which', ['playwright'], { encoding: 'utf8', env: childEnv }).trim()))('playwright');
const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
let server;
let browser;
try {
  if (!process.env.VIDEO_MONTH_BROWSER_BASE_URL) {
    server = spawn('npm', ['--workspace', '@ai-video-qc/web', 'run', 'dev', '--', '-p', '3112'], { cwd: root, env: childEnv, stdio: 'ignore' });
    for (let attempt = 0; ; attempt += 1) {
      try { if ((await fetch(`${base}/login`)).ok) break; } catch {}
      if (attempt >= 80) throw Error('Local browser server did not become ready.');
      await new Promise(done => setTimeout(done, 500));
    }
  }
  browser = await chromium.launch({ headless: true, ...(process.env.V11_CHROMIUM_EXECUTABLE ? { executablePath: process.env.V11_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext();
  let role = 'admin';
  const requests = [];
  const fixtures = [
    { id: 'august', title: 'August historical video', createdAt: '2026-08-15T04:00:00Z', creator: { id: 'other', name: 'Other owner' }, status: 'submitted' },
    { id: 'october', title: 'October own video', createdAt: '2026-10-15T04:00:00Z', creator: { id: 'owner', name: 'Own account' }, status: 'submitted' },
  ];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== target.origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let body = {};
    if (url.pathname === '/api/auth/me') body = { user: { id: 'owner', name: 'Test user', account: 'test', role } };
    if (url.pathname === '/api/videos') {
      requests.push(new URL(url));
      const items = fixtures.filter(video => (role === 'admin' || video.creator.id === 'owner')
        && (!url.searchParams.get('month') || video.createdAt.startsWith(url.searchParams.get('month')))
        && (!url.searchParams.get('creatorId') || video.creator.id === url.searchParams.get('creatorId')));
      body = { items, total: items.length, page: 1, pageSize: 20 };
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const page = await context.newPage();
  const month = () => page.locator('input[name="month"]');
  async function settled() {
    await page.getByRole('status').waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: '视频任务', exact: true }).waitFor();
  }
  await page.goto(`${base}/videos`);
  await page.getByRole('link', { name: 'August historical video', exact: true }).waitFor();
  await settled();
  assert.equal(requests.at(-1).searchParams.has('month'), false);
  assert.equal(await month().inputValue(), '');
  assert.equal(await page.getByRole('link', { name: 'October own video', exact: true }).count(), 1);
  assert.equal(requests.at(-1).searchParams.has('creatorId'), false);
  console.log('PASS no month sends no month; admin sees all historical months and owners');

  await month().fill('2026-08');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.waitForURL('**/videos?month=2026-08&page=1');
  await settled();
  assert.equal(requests.at(-1).searchParams.get('month'), '2026-08');
  assert.equal(await page.getByRole('link', { name: 'October own video', exact: true }).count(), 0);
  assert.equal(await month().inputValue(), '2026-08');
  console.log('PASS explicit August filters API and visible results to August');

  await month().fill('');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.waitForURL('**/videos?page=1');
  await page.getByRole('link', { name: 'October own video', exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.has('month'), false);
  assert.equal(requests.at(-1).searchParams.has('month'), false);
  assert.equal(await page.getByRole('link', { name: 'August historical video', exact: true }).count(), 1);
  console.log('PASS clearing month removes it from URL/API and restores all months');

  await page.goBack();
  await page.waitForFunction(() => document.querySelector('input[name="month"]').value === '2026-08');
  await settled();
  assert.equal(requests.at(-1).searchParams.get('month'), '2026-08');
  await page.goForward();
  await page.waitForFunction(() => document.querySelector('input[name="month"]').value === '');
  await settled();
  assert.equal(requests.at(-1).searchParams.has('month'), false);
  console.log('PASS month UI follows URL on back/forward without stale defaultValue');

  await page.getByText('更多筛选', { exact: true }).click();
  await page.locator('input[name="creatorId"]').fill('other');
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.waitForURL('**/videos?creatorId=other&page=1');
  await settled();
  assert.equal(requests.at(-1).searchParams.get('creatorId'), 'other');
  assert.equal(requests.at(-1).searchParams.has('month'), false);
  assert.equal(await page.getByRole('link', { name: 'October own video', exact: true }).count(), 0);
  console.log('PASS admin creator filter remains independent of month');

  role = 'director';
  await page.goto(`${base}/videos`);
  await page.getByRole('link', { name: 'October own video', exact: true }).waitFor();
  await settled();
  assert.equal(await page.locator('input[name="creatorId"]').count(), 0);
  assert.equal(await page.getByRole('link', { name: 'August historical video', exact: true }).count(), 0);
  console.log('PASS non-admin UI retains owner-only fixture and no creator control');
  console.log('VIDEO_MONTH_BROWSER=PASS (6 scenarios; mocked API, no database/model)');
} finally {
  await browser?.close();
  if (server) {
    server.kill('SIGTERM');
    await new Promise(done => server.once('exit', done));
  }
}
