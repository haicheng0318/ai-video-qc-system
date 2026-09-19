import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiFetch, ApiRequestError } from '../lib/api';

test('api requests use cookie credentials and mutations carry the CSRF marker', async () => {
  const oldFetch = globalThis.fetch;
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  try {
    await apiFetch('/api/auth/me');
    await apiFetch('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    assert.equal(requests[0]?.init?.credentials, 'include');
    assert.equal(new Headers(requests[0]?.init?.headers).has('Authorization'), false);
    assert.equal(new Headers(requests[0]?.init?.headers).has('X-QC-CSRF'), false);
    assert.equal(requests[1]?.init?.credentials, 'include');
    assert.equal(new Headers(requests[1]?.init?.headers).get('X-QC-CSRF'), '1');
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('incorrect login stays on login page while expired protected requests redirect', async () => {
  const oldFetch = globalThis.fetch;
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const windowMock = {
    location: { href: '/login' },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowMock });
  globalThis.fetch = async () => new Response(JSON.stringify({ message: '账号或密码错误' }), { status: 401 });
  try {
    await assert.rejects(apiFetch('/api/auth/login', { method: 'POST' }), ApiRequestError);
    assert.equal(windowMock.location.href, '/login');
    windowMock.location.href = '/videos';
    await assert.rejects(apiFetch('/api/auth/me'), ApiRequestError);
    assert.equal(windowMock.location.href, '/login');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
