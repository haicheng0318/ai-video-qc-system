import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { browserOutput } from './local-browser-output.mjs';
import { localBrowserEnvironment } from './local-browser-environment.mjs';

const { base, childEnv } = localBrowserEnvironment(process.env, 'OPS_BROWSER_BASE_URL', 'http://127.0.0.1:3044');
const executable = execFileSync('which', ['playwright'], { encoding: 'utf8', env: childEnv }).trim();
const { chromium } = createRequire(realpathSync(executable))('playwright');
const output = browserOutput('operations'); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, env: childEnv });
const job = { id: '00000000-0000-4000-8000-000000000001', videoId: '00000000-0000-4000-8000-000000000002', actorId: 'local-user', stage: 'content', status: 'needs_attention', attempts: 1, attemptsHistory: [{ attemptNumber: 1, status: 'needs_attention', startedAt: '2026-09-10T01:00:00.000Z' }], usage: [] };
const tables = {
  '/api/auth/me': { user: { id: 'local-admin', name: '本地管理验收', role: 'admin', account: 'fixture' } },
  '/api/admin/operations/overview': { activeUsers: 12, formalVideos: 38, trialVideos: 4, worker: 'unknown', jobs: [{ stage: 'content', status: 'needs_attention', count: 2 }], observedAt: '2026-09-10T05:00:00.000Z' },
  '/api/admin/operations/jobs': { items: [job], total: 1, pageSize: 20 },
  [`/api/admin/operations/jobs/${job.id}`]: job,
  '/api/admin/operations/usage': { items: [], total: 0, pageSize: 20, coverage: 'collection_since_migration_only' },
  '/api/admin/operations/usage-summary': { groups: [{ stage: 'content', modelName: '本地模拟模型', status: 'uncertain', calls: 1, estimatedCost: null, actualCost: null, estimateObserved: 0, actualObserved: 0, currency: null }], billingStatus: 'not_connected' },
  '/api/admin/operations/dependencies': { api: 'alive', database: 'available', worker: { status: 'unknown', lastSeenAt: null }, ai: 'not_probed', storage: 'not_probed', resources: 'not_connected', backups: 'not_connected', certificates: 'not_connected', cloudBilling: 'not_connected', paidDiagnostic: 'manual_only_not_executed' },
  '/api/admin/operations/settings': { items: [] },
  '/api/admin/operations/configuration-revisions': { items: [], total: 40, pageSize: 20 },
};
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const requests = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    requests.push(url);
    if (route.request().method() !== 'GET') throw new Error('Read-only browser acceptance must not mutate data.');
    return route.fulfill({ json: tables[url.pathname] || { items: [], total: 0, pageSize: 20 } });
  });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/admin`);
  await page.getByText('活跃账号', { exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: '管理运行中心', exact: true }).count(), 1);
  await page.screenshot({ path: resolve(output, 'desktop-overview.png'), fullPage: true });
  await page.getByRole('button', { name: '评估任务', exact: true }).click();
  await page.getByRole('textbox', { name: '用户编号', exact: true }).fill(job.id);
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.getByRole('button', { name: '查看尝试记录' }).click();
  await page.getByRole('button', { name: '确认重试', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '确认重试', exact: true }).isEnabled(), false);
  await page.getByRole('textbox', { name: '操作原因' }).fill('只检查表单，不发起模型调用');
  await page.getByRole('checkbox').check();
  assert.equal(await page.getByRole('button', { name: '确认重试', exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: '调用与费用', exact: true }).click();
  await page.getByRole('heading', { name: '分类汇总' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '用户编号', exact: true }).inputValue(), '', 'switching modules resets visible filters');
  assert.equal(requests.filter(u => u.pathname.endsWith('/usage')).at(-1).searchParams.has('userId'), false, 'displayed empty filter matches request');
  assert.ok((await page.locator('main').innerText()).includes('未接入'));
  await page.getByRole('button', { name: '设置与版本', exact: true }).click();
  await page.getByRole('heading', { name: '费用估算费率' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '保存费率版本' }).isEnabled(), false);
  await page.getByRole('textbox', { name: '备注', exact: true }).fill('尚未保存的备注');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByText('第 2 页，共 40 条').waitFor();
  assert.equal(await page.getByRole('textbox', { name: '备注', exact: true }).inputValue(), '尚未保存的备注', 'history pagination must not reset draft');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '依赖状态', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: '备注', exact: true }).inputValue(), '尚未保存的备注', 'cancelled navigation keeps draft');
  page.once('dialog', dialog => dialog.accept());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '依赖状态', exact: true }).click();
  await page.getByText('服务器资源', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'mobile viewport must not overflow');
  await page.screenshot({ path: resolve(output, 'mobile-dependencies.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: desktop overview, controlled retry form, unknown billing, settings, mobile dependency layout; no mutation or external requests.');
} finally { await browser.close(); }
