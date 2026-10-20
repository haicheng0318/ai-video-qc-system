import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { localBrowserEnvironment } from './local-browser-environment.mjs';

const { base, target, childEnv } = localBrowserEnvironment(process.env, 'ADMIN_CREDENTIAL_BROWSER_BASE_URL', 'http://127.0.0.1:3118');
const { chromium } = createRequire(realpathSync(execFileSync('which', ['playwright'], { encoding: 'utf8', env: childEnv }).trim()))('playwright');
const browser = await chromium.launch({ headless: true, env: childEnv });
const targetId = '00000000-0000-4000-8000-000000000031';
const adminId = '00000000-0000-4000-8000-000000000032';
const assignedPassword = 'FixtureOnly-Admin-123';
const randomPassword = 'FixtureOnly-Random-123';
const checks = [];

async function setup({ self = false, role = 'admin' } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const user = { id: targetId, account: 'fixture.target', name: '本地凭据验收账号', role: self ? 'admin' : 'director', status: 'active', expiresAt: null, mustChangePassword: false };
  const actor = { ...user, id: self ? targetId : adminId, account: 'fixture.admin', role };
  const requests = [], errors = [];
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== target.origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    assert(!url.search.includes('password') && !url.href.includes(assignedPassword) && !url.href.includes(randomPassword));
    const method = request.method(), body = request.postData() ? JSON.parse(request.postData()) : null;
    requests.push({ method, path: url.pathname, body });
    if (url.pathname.startsWith('/api/admin/') && role !== 'admin') return route.fulfill({ status: 403, json: { message: 'Administrator required.' } });
    let response = {};
    if (url.pathname === '/api/auth/me') response = { user: actor };
    else if (url.pathname === '/api/videos') response = { items: [], total: 0, page: 1, pageSize: 20 };
    else if (url.pathname === '/api/admin/users' && method === 'GET') response = { items: [user], total: 1, page: 1, pageSize: 20 };
    else if (url.pathname === '/api/admin/users' && method === 'POST') response = { user: { ...user, id: '00000000-0000-4000-8000-000000000033', account: body.account, name: body.name, mustChangePassword: body.initialPassword ? body.mustChangePassword : true }, initialPassword: body.initialPassword || randomPassword };
    else if (url.pathname === `/api/admin/users/${targetId}` && method === 'GET') response = { user };
    else if (url.pathname === `/api/admin/users/${targetId}` && method === 'PATCH') { user.account = body.account; response = { user }; }
    else if (url.pathname.endsWith('/sessions')) response = { items: [] };
    else if (url.pathname.endsWith('/quotas')) response = { quotas: [] };
    else if (url.pathname.endsWith('/set-password')) { user.mustChangePassword = body.mustChangePassword; response = { success: true }; }
    else if (url.pathname.endsWith('/reset-password')) response = { initialPassword: randomPassword };
    else throw Error(`Unexpected credential fixture route ${method} ${url.pathname}`);
    return route.fulfill({ status: method === 'POST' ? 201 : 200, json: response });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  return { context, page, requests, errors };
}

try {
  const { context, page, requests, errors } = await setup();
  await page.goto(base + '/admin/users');
  await page.getByRole('heading', { name: '账号管理', exact: true }).waitFor();
  const create = page.locator('section').filter({ has: page.getByRole('heading', { name: '创建账号', exact: true }) });
  assert.equal(await create.locator('input[name=account]').getAttribute('pattern'), null);
  assert.equal(await create.locator('input[name=account]').getAttribute('maxlength'), '100');
  await create.locator('input[name=account]').fill('  中文 Fixture 账号  ');
  await create.locator('input[name=name]').fill('Fixture 新账号');
  await create.locator('input[name=initialPassword]').fill('Fixture8');
  const createMustChange = create.getByRole('checkbox', { name: '首次登录要求修改密码', exact: true });
  assert.equal(await createMustChange.isChecked(), true);
  await createMustChange.uncheck(); await create.locator('input[name=reason]').fill('FixtureOnly creation');
  await create.getByRole('button', { name: '创建账号', exact: true }).click();
  await create.getByText('账号已创建，请立即安全交付初始密码', { exact: true }).waitFor();
  const creation = requests.find(r => r.method === 'POST' && r.path === '/api/admin/users');
  assert.equal(creation.body.account, '中文 Fixture 账号'); assert.equal(creation.body.initialPassword, 'Fixture8'); assert.equal(creation.body.mustChangePassword, false);
  await create.getByRole('button', { name: '我已保存，关闭提示', exact: true }).click();
  checks.push('create Unicode account / assigned8 / mustChange default and payload');

  await page.locator('tr').filter({ hasText: 'fixture.target' }).getByRole('link', { name: '查看详情', exact: true }).click();
  await page.getByRole('heading', { name: '本地凭据验收账号', exact: true }).waitFor();
  await page.getByLabel('登录用户名', { exact: true }).fill('本地 新账号');
  await page.locator('#update-reason').fill('FixtureOnly account rename');
  await page.getByRole('button', { name: '保存账号资料', exact: true }).click();
  await page.getByText('账号资料已更新，相关旧会话会按安全规则失效。', { exact: true }).waitFor();
  assert.equal(requests.find(r => r.method === 'PATCH').body.account, '本地 新账号');
  checks.push('list to detail / account PATCH payload');

  const password = page.getByLabel('设置新密码', { exact: true }), confirm = page.getByLabel('确认新密码', { exact: true });
  assert.equal(await password.getAttribute('type'), 'password'); assert.equal(await password.getAttribute('autocomplete'), 'new-password');
  await password.fill('😀'.repeat(4)); await confirm.fill('😀'.repeat(4));
  await page.locator('#security-reason').fill('FixtureOnly Unicode validation');
  await page.getByRole('button', { name: '设置新密码', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /8–128/ }).waitFor();
  assert.equal(requests.filter(r => r.path.endsWith('/set-password')).length, 0);
  await password.fill(assignedPassword); await confirm.fill('FixtureOnly-Mismatch-123');
  await page.locator('#security-reason').fill('FixtureOnly assigned password');
  await page.getByRole('button', { name: '设置新密码', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /两次.*密码.*一致/ }).waitFor();
  assert.equal(requests.filter(r => r.path.endsWith('/set-password')).length, 0);
  await confirm.fill(assignedPassword);
  const mustChange = page.getByRole('checkbox', { name: '首次登录要求修改密码', exact: true });
  assert.equal(await mustChange.isChecked(), false); await mustChange.check();
  await page.getByRole('checkbox', { name: '显示密码', exact: true }).check();
  assert.equal(await password.getAttribute('type'), 'text');
  await page.getByRole('checkbox', { name: '显示密码', exact: true }).uncheck();
  await page.getByRole('button', { name: '设置新密码', exact: true }).click();
  await page.getByText('密码已修改，该账号全部旧会话已撤销。', { exact: true }).waitFor();
  const setting = requests.find(r => r.path.endsWith('/set-password'));
  assert.equal(setting.body.password, assignedPassword); assert.equal(setting.body.mustChangePassword, true);
  assert.equal(await password.inputValue(), ''); assert.equal(await confirm.inputValue(), '');
  checks.push('mismatch blocks POST / masked reveal / specified-password payload / clear fields');
  await page.locator('#security-reason').fill('FixtureOnly random reset');
  await page.getByRole('button', { name: '生成随机密码', exact: true }).click();
  await page.getByText(randomPassword, { exact: true }).waitFor();
  assert.equal(requests.filter(r => r.path.endsWith('/reset-password')).length, 1);
  await page.getByRole('button', { name: '我已保存，关闭提示', exact: true }).click();
  assert.equal(await page.getByText(randomPassword, { exact: true }).count(), 0);
  await page.reload(); await page.getByRole('heading', { name: '本地凭据验收账号', exact: true }).waitFor();
  assert.equal(await page.getByText(randomPassword, { exact: true }).count(), 0);
  assert.deepEqual(errors, []); await context.close();
  checks.push('random reset retained / credential displayed once, not persisted');

  for (const kind of ['account', 'password']) {
    const { context: c, page: p } = await setup({ self: true });
    await p.goto(base + `/admin/users/${targetId}`); await p.getByRole('heading', { name: '本地凭据验收账号', exact: true }).waitFor();
    if (kind === 'account') {
      await p.getByLabel('登录用户名', { exact: true }).fill('新的管理员 Fixture'); await p.locator('#update-reason').fill('FixtureOnly self account');
      await p.getByRole('button', { name: '保存账号资料', exact: true }).click();
    } else {
      await p.getByLabel('设置新密码', { exact: true }).fill(assignedPassword); await p.getByLabel('确认新密码', { exact: true }).fill(assignedPassword); await p.locator('#security-reason').fill('FixtureOnly self password');
      await p.getByRole('button', { name: '设置新密码', exact: true }).click();
    }
    await p.waitForURL(/\/admin\/login/);
    await p.getByText(kind === 'account' ? '登录账号已修改，请使用新账号重新登录。' : '密码已修改，请使用新密码重新登录。', { exact: true }).waitFor();
    assert(!p.url().includes(assignedPassword)); await c.close(); checks.push('self ' + kind + ' redirects to admin login with non-secret notice');
  }
  const { context: denied, page: nonAdmin } = await setup({ role: 'director' });
  await nonAdmin.goto(base + `/admin/users/${targetId}`); await nonAdmin.waitForURL('**/videos');
  assert.equal(await nonAdmin.getByRole('button', { name: '设置新密码', exact: true }).count(), 0); await denied.close();
  checks.push('non-admin has no credential entry');
  console.log(JSON.stringify({ ok: true, checks, productionTouched: false, paidModelCalls: 0 }));
} finally { await browser.close(); }
