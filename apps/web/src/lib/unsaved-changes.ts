'use client';

import { useEffect } from 'react';

type GuardWindow = Pick<Window, 'addEventListener' | 'removeEventListener' | 'confirm' | 'location'> & {
  history?: Pick<History, 'state' | 'pushState' | 'replaceState'>;
};
type GuardDocument = Pick<Document, 'addEventListener' | 'removeEventListener'>;
type NavigationTarget = {
  addEventListener: (name: 'navigate', handler: (event: any) => void) => void;
  removeEventListener: (name: 'navigate', handler: (event: any) => void) => void;
};
type NextRouterTarget = Partial<Record<'push' | 'replace' | 'back' | 'forward', (...args: any[]) => unknown>>;

export function installUnsavedChangesGuard(
  isDirty: () => boolean,
  targetWindow: GuardWindow = window,
  targetDocument: GuardDocument = document,
) {
  let leaving = false;
  const navigation = (targetWindow as GuardWindow & { navigation?: NavigationTarget }).navigation;
  const nextRouter = (targetWindow as GuardWindow & { next?: { router?: NextRouterTarget } }).next?.router;
  const originalRouterMethods = new Map<keyof NextRouterTarget, (...args: any[]) => unknown>();
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!leaving && isDirty()) {
      event.preventDefault?.();
      event.returnValue = '';
    }
  };
  const click = (event: MouseEvent) => {
    if (leaving || !isDirty() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute?.('download')) return;
    const next = new URL(anchor.href, targetWindow.location.href);
    if (next.origin !== targetWindow.location.origin || next.href === targetWindow.location.href) return;
    event.preventDefault();
    if (!targetWindow.confirm('当前表单有未保存修改，确定离开吗？')) return;
    leaving = true;
    targetWindow.location.assign(next.href);
  };
  const navigate = (event: any) => {
    if (leaving || !isDirty() || !event.canIntercept) return;
    const next = new URL(event.destination.url, targetWindow.location.href);
    if (next.href === targetWindow.location.href) return;
    if (targetWindow.confirm('当前表单有未保存修改，确定离开吗？')) {
      leaving = true;
      return;
    }
    event.preventDefault();
  };
  if (nextRouter) {
    for (const method of ['push', 'replace', 'back', 'forward'] as const) {
      const original = nextRouter[method];
      if (typeof original !== 'function') continue;
      originalRouterMethods.set(method, original);
      nextRouter[method] = (...args: any[]) => {
        if (!leaving && isDirty()) {
          const destination = typeof args[0] === 'string' ? new URL(args[0], targetWindow.location.href).href : null;
          if (destination === targetWindow.location.href) return original.apply(nextRouter, args);
          if (!targetWindow.confirm('当前表单有未保存修改，确定离开吗？')) return undefined;
          leaving = true;
        }
        return original.apply(nextRouter, args);
      };
    }
  }
  const history = targetWindow.history;
  const originalPushState = history?.pushState;
  const originalReplaceState = history?.replaceState;
  const currentUrl = targetWindow.location.href;
  const currentState = history?.state;
  const approveHistoryChange = (url?: string | URL | null) => {
    if (leaving || !isDirty() || url == null) return true;
    const next = new URL(String(url), targetWindow.location.href);
    if (next.href === targetWindow.location.href) return true;
    if (!targetWindow.confirm('当前表单有未保存修改，确定离开吗？')) return false;
    leaving = true;
    return true;
  };
  let guardedPushState: History['pushState'] | undefined;
  let guardedReplaceState: History['replaceState'] | undefined;
  const popState = (event: PopStateEvent) => {
    if (leaving || !isDirty()) return;
    if (targetWindow.confirm('当前表单有未保存修改，确定离开吗？')) {
      leaving = true;
      return;
    }
    event.stopImmediatePropagation();
    originalPushState?.call(history, currentState, '', currentUrl);
  };
  if (!navigation && history && originalPushState && originalReplaceState) {
    guardedPushState = (data, unused, url) => {
      if (approveHistoryChange(url)) originalPushState.call(history, data, unused, url);
    };
    guardedReplaceState = (data, unused, url) => {
      if (approveHistoryChange(url)) originalReplaceState.call(history, data, unused, url);
    };
    history.pushState = guardedPushState;
    history.replaceState = guardedReplaceState;
    targetWindow.addEventListener('popstate', popState, true);
  }
  targetWindow.addEventListener('beforeunload', beforeUnload);
  targetDocument.addEventListener('click', click, true);
  navigation?.addEventListener('navigate', navigate);
  return () => {
    targetWindow.removeEventListener('beforeunload', beforeUnload);
    if (!navigation && history) {
      targetWindow.removeEventListener('popstate', popState, true);
      if (history.pushState === guardedPushState && originalPushState) history.pushState = originalPushState;
      if (history.replaceState === guardedReplaceState && originalReplaceState) history.replaceState = originalReplaceState;
    }
    targetDocument.removeEventListener('click', click, true);
    navigation?.removeEventListener('navigate', navigate);
    if (nextRouter) {
      for (const [method, original] of originalRouterMethods) {
        nextRouter[method] = original;
      }
    }
  };
}

export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return undefined;
    return installUnsavedChangesGuard(() => true);
  }, [dirty]);
}
