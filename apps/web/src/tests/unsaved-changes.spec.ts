import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installUnsavedChangesGuard } from '../lib/unsaved-changes';

test('dirty same-origin navigation is canceled without losing the form', () => {
  let handler: ((event: any) => void) | undefined;
  let assigned = '';
  const document = {
    addEventListener: (_name: string, next: (event: any) => void) => { handler = next; },
    removeEventListener: () => undefined,
  };
  const window = {
    location: { href: 'https://qc.example/videos/one', origin: 'https://qc.example', assign: (href: string) => { assigned = href; } },
    confirm: () => false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const cleanup = installUnsavedChangesGuard(() => true, window as any, document as any);
  let prevented = false;
  handler?.({ button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    target: { closest: () => ({ href: 'https://qc.example/videos/two', target: '' }) },
    preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(assigned, '');
  cleanup();
});

test('confirmed same-origin navigation leaves exactly once and refresh warns while dirty', () => {
  const handlers = new Map<string, (event: any) => void>();
  let assigned = '';
  const document = { addEventListener: (name: string, handler: any) => handlers.set(name, handler), removeEventListener: () => undefined };
  const window = {
    location: { href: 'https://qc.example/videos/one', origin: 'https://qc.example', assign: (href: string) => { assigned = href; } },
    confirm: () => true,
    addEventListener: (name: string, handler: any) => handlers.set(name, handler),
    removeEventListener: () => undefined,
  };
  installUnsavedChangesGuard(() => true, window as any, document as any);
  const unload: any = {};
  handlers.get('beforeunload')?.(unload);
  assert.equal(unload.returnValue, '');
  handlers.get('click')?.({ button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    target: { closest: () => ({ href: 'https://qc.example/videos/two', target: '' }) }, preventDefault: () => undefined });
  assert.equal(assigned, 'https://qc.example/videos/two');
});

test('Navigation API cancels browser history and programmatic navigation while dirty', () => {
  let navigate: ((event: any) => void) | undefined;
  const navigation = {
    addEventListener: (_name: string, handler: (event: any) => void) => { navigate = handler; },
    removeEventListener: () => undefined,
  };
  const document = { addEventListener: () => undefined, removeEventListener: () => undefined };
  const window = {
    navigation,
    location: { href: 'https://qc.example/videos/new', origin: 'https://qc.example', assign: () => undefined },
    confirm: () => false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  installUnsavedChangesGuard(() => true, window as any, document as any);
  let prevented = false;
  navigate?.({ canIntercept: true, destination: { url: 'https://qc.example/videos' }, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
});

test('history fallback restores the current URL when back or forward navigation is canceled', () => {
  const handlers = new Map<string, (event: any) => void>();
  let restored = '';
  const history = {
    state: { current: true },
    pushState: (_state: unknown, _unused: string, url?: string | URL | null) => { restored = String(url); },
    replaceState: () => undefined,
  };
  const window = {
    history,
    location: { href: 'https://qc.example/videos/new', origin: 'https://qc.example', assign: () => undefined },
    confirm: () => false,
    addEventListener: (name: string, handler: any) => handlers.set(name, handler),
    removeEventListener: () => undefined,
  };
  const document = { addEventListener: () => undefined, removeEventListener: () => undefined };
  installUnsavedChangesGuard(() => true, window as any, document as any);
  let stopped = false;
  handlers.get('popstate')?.({ stopImmediatePropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(restored, 'https://qc.example/videos/new');
});

test('history fallback cancels programmatic pushState while dirty', () => {
  let pushed = '';
  const history = {
    state: {},
    pushState: (_state: unknown, _unused: string, url?: string | URL | null) => { pushed = String(url); },
    replaceState: () => undefined,
  };
  const window = {
    history,
    location: { href: 'https://qc.example/videos/new', origin: 'https://qc.example', assign: () => undefined },
    confirm: () => false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const document = { addEventListener: () => undefined, removeEventListener: () => undefined };
  installUnsavedChangesGuard(() => true, window as any, document as any);
  history.pushState({}, '', '/videos');
  assert.equal(pushed, '');
});

test('actual Next router push is canceled before its route state changes', () => {
  let routeChanges = 0;
  const router = {
    push: (_path?: string) => { routeChanges += 1; }, replace: (_path?: string) => { routeChanges += 1; },
    back: () => { routeChanges += 1; }, forward: () => { routeChanges += 1; },
  };
  const window = {
    next: { router },
    location: { href: 'https://qc.example/videos/new', origin: 'https://qc.example', assign: () => undefined },
    confirm: () => false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const document = { addEventListener: () => undefined, removeEventListener: () => undefined };
  installUnsavedChangesGuard(() => true, window as any, document as any);
  router.push('/videos');
  assert.equal(routeChanges, 0);
});
