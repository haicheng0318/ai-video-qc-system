import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { localBrowserEnvironment } from './local-browser-environment.mjs';

// Real built UI, two administrator tabs, in-memory transport only. No backend writes.
const { base, childEnv } = localBrowserEnvironment(process.env, 'OPS_BROWSER_BASE_URL', 'http://127.0.0.1:3044');
const { chromium } = createRequire(realpathSync(execFileSync('which', ['playwright'], { encoding: 'utf8', env: childEnv }).trim()))('playwright');
const browser = await chromium.launch({ headless: true, env: childEnv });
const writes = []; const errors = [];
const rows = {
  cost_rates: { key: 'cost_rates', version: 1, value: { provider: 'aliyun_bailian', modelName: 'local-test', currency: 'CNY', inputPerMillion: 1, outputPerMillion: 2 } },
  business_notice: { key: 'business_notice', version: 1, value: { text: '原备注' } },
  site: { key: 'site', version: 1, value: { name: '原站点', notice: '原公告' } },
};
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (request.method() === 'PUT' && url.pathname.startsWith('/api/admin/operations/settings/')) {
      const key = url.pathname.split('/').at(-1); const payload = request.postDataJSON(); const current = rows[key];
      assert.ok(current, 'only three local fixture settings may change');
      const status = payload.expectedVersion === current.version ? 200 : 409;
      writes.push({ key, payload, status });
      if (status === 409) return route.fulfill({ status, json: { message: '配置版本冲突，请重新加载。' } });
      rows[key] = { key, version: current.version + 1, value: payload.value };
      return route.fulfill({ json: rows[key] });
    }
    assert.equal(request.method(), 'GET', 'no other mutation allowed');
    const body = url.pathname === '/api/auth/me' ? { user: { id: 'local-admin', role: 'admin', name: '本地管理员' } }
      : url.pathname === '/api/admin/operations/settings' ? { items: Object.values(rows), defaults: {} }
      : { items: [], total: 0, pageSize: 20 };
    return route.fulfill({ json: body });
  });
  const a = await context.newPage(), b = await context.newPage();
  for (const page of [a, b]) { page.on('pageerror', error => errors.push(error.message)); await page.goto(`${base}/admin?section=settings`); await page.getByRole('heading', { name: '费用估算费率' }).waitFor(); }
  const rateForm = page => page.locator('form').filter({ has: page.getByRole('heading', { name: '费用估算费率' }) });
  const authorize = async (page, reason) => { await rateForm(page).getByRole('textbox', { name: '操作原因', exact: true }).fill(reason); await rateForm(page).getByRole('checkbox').check(); };
  const saved = async (page, button, key) => {
    const response = page.waitForResponse(r => r.url().endsWith(`/settings/${key}`) && r.request().method() === 'PUT');
    await button.click(); const result = await response; await page.getByRole('button', { name: '刷新', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('main button')?.disabled);
    return result.status();
  };
  await a.getByRole('spinbutton', { name: '每百万输入 Token 费用' }).fill('10');
  await b.getByRole('spinbutton', { name: '每百万输出 Token 费用' }).fill('99');
  await authorize(b, 'B保存新费率'); assert.equal(await saved(b, b.getByRole('button', { name: '保存费率版本' }), 'cost_rates'), 200);
  await a.getByRole('textbox', { name: '备注', exact: true }).fill('A保存其他项');
  await authorize(a, 'A保存备注'); assert.equal(await saved(a, a.getByRole('button', { name: '保存备注', exact: true }), 'business_notice'), 200);
  assert.equal(await a.getByRole('spinbutton', { name: '每百万输入 Token 费用' }).inputValue(), '10');
  assert.equal(await a.getByRole('spinbutton', { name: '每百万输出 Token 费用' }).inputValue(), '2');
  await authorize(a, 'A提交旧草稿');
  assert.equal(await saved(a, a.getByRole('button', { name: '保存费率版本' }), 'cost_rates'), 409, 'old draft must not silently overwrite B');
  assert.equal(writes.at(-1).payload.expectedVersion, 1);
  assert.equal(rows.cost_rates.value.outputPerMillion, 99);
  assert.match(await rateForm(a).innerText(), /新版本|冲突/);
  a.once('dialog', dialog => dialog.accept()); await rateForm(a).getByRole('button', { name: '重载此项最新版本' }).click();
  assert.equal(await a.getByRole('spinbutton', { name: '每百万输出 Token 费用' }).inputValue(), '99');
  await a.getByRole('spinbutton', { name: '每百万输入 Token 费用' }).fill('11'); await authorize(a, 'A基于新版本保存');
  assert.equal(await saved(a, a.getByRole('button', { name: '保存费率版本' }), 'cost_rates'), 200); assert.equal(writes.at(-1).payload.expectedVersion, 2);

  // PolicyForm must retain the draft and its original base when another save refreshes rows.
  const site = page => page.locator('details').filter({ has: page.locator('summary').filter({ hasText: '站点信息' }) });
  for (const page of [a, b]) await site(page).locator('summary').click();
  await site(a).getByRole('textbox', { name: '站点名称', exact: true }).fill('A未保存站点');
  await site(b).getByRole('textbox', { name: '公告', exact: true }).fill('B新公告');
  await site(b).getByRole('textbox', { name: '操作原因' }).fill('B站点变更'); await site(b).getByRole('checkbox').check();
  assert.equal(await saved(b, site(b).getByRole('button', { name: '保存策略版本' }), 'site'), 200);
  await a.getByRole('textbox', { name: '备注', exact: true }).fill('A再次保存其他项'); await authorize(a, '触发后台刷新');
  assert.equal(await saved(a, a.getByRole('button', { name: '保存备注', exact: true }), 'business_notice'), 200);
  assert.equal(await site(a).getByRole('textbox', { name: '站点名称', exact: true }).inputValue(), 'A未保存站点', 'dirty PolicyForm must not remount on server version');
  assert.equal(await site(a).getByRole('textbox', { name: '公告', exact: true }).inputValue(), '原公告');
  await site(a).getByRole('textbox', { name: '操作原因' }).fill('A旧站点草稿'); await site(a).getByRole('checkbox').check();
  assert.equal(await saved(a, site(a).getByRole('button', { name: '保存策略版本' }), 'site'), 409); assert.equal(writes.at(-1).payload.expectedVersion, 1); assert.equal(rows.site.value.notice, 'B新公告');
  assert.match(await site(a).innerText(), /新版本|冲突/);
  a.once('dialog', dialog => dialog.accept()); await site(a).getByRole('button', { name: '重载此项最新版本' }).click();
  assert.equal(await site(a).getByRole('textbox', { name: '公告', exact: true }).inputValue(), 'B新公告');
  await site(a).getByRole('textbox', { name: '站点名称', exact: true }).fill('A合并后站点');
  await site(a).getByRole('textbox', { name: '操作原因' }).fill('基于已重载版本'); await site(a).getByRole('checkbox').check();
  assert.equal(await saved(a, site(a).getByRole('button', { name: '保存策略版本' }), 'site'), 200); assert.equal(writes.at(-1).payload.expectedVersion, 2);
  await site(a).getByRole('textbox', { name: '站点名称', exact: true }).fill('A继续编辑站点');
  await site(a).getByRole('textbox', { name: '操作原因' }).fill('基于自己的保存结果'); await site(a).getByRole('checkbox').check();
  assert.equal(await saved(a, site(a).getByRole('button', { name: '保存策略版本' }), 'site'), 200); assert.equal(writes.at(-1).payload.expectedVersion, 3);
  assert.deepEqual(errors, []);
  console.log('PASS: two-tab rate/policy drafts retain baseVersion, reject stale writes, preserve dirty forms, and explicitly reload latest versions; no real writes.');
} finally { await browser.close(); }
