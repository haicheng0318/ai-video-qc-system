import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('runtime facts distinguish unconnected, unknown and observed zero values', async () => {
  const path = '../components/admin/runtime-panels';
  const mod = await import(path).catch(() => ({}));
  assert.equal(typeof mod.RuntimeFacts, 'function', 'runtime facts component must exist');
  const html = renderToStaticMarkup(React.createElement(mod.RuntimeFacts, { values: { 账单: 'not_connected', 用量: null, 调用次数: 0, 密钥状态: false } }));
  assert.match(html, /未接入/); assert.match(html, /未知/); assert.match(html, />0</);
});

test('runtime table shows labels and safe empty state instead of internal objects', async () => {
  const path = '../components/admin/runtime-panels'; const mod = await import(path).catch(() => ({}));
  assert.equal(typeof mod.RuntimeTable, 'function');
  const html = renderToStaticMarkup(React.createElement(mod.RuntimeTable, { rows: [{ id: 'one', status: 'needs_attention', rawResponse: 'SECRET' }], columns: [['status', '状态']] }));
  assert.match(html, /需人工处理/); assert.equal(html.includes('SECRET'), false);
});

test('management actions and execution outcomes use Chinese labels', async () => {
  const { runtimeValue } = await import('../components/admin/runtime-panels');
  for (const value of ['admin_evaluation_retry','admin_setting_updated','admin_usage_export','admin_logs_export','management_access_denied','platform_benchmark_updated','expired','success','failure','rate_limit','timeout','parsing']) assert.match(runtimeValue(value), /[一-鿿]/);
});
