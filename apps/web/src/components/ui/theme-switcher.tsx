'use client';

import { useEffect, useState } from 'react';
import { parseThemePreference, resolveTheme, THEME_STORAGE_KEY, ThemePreference } from '@/lib/theme';

export function ThemeSwitcher() {
  const [preference, setPreference] = useState<ThemePreference>('system');
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    try {
      document.documentElement.dataset.themePreference = parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
    } catch { /* Keep the pre-paint preference when storage is unavailable. */ }
    function apply() {
      const value = parseThemePreference(document.documentElement.dataset.themePreference);
      setPreference(value);
      const theme = resolveTheme(value, media.matches);
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    }
    function sync(event: StorageEvent) {
      if (event.key === THEME_STORAGE_KEY || event.key === null) {
        document.documentElement.dataset.themePreference = parseThemePreference(event.newValue);
        apply();
      }
    }
    apply();
    media.addEventListener('change', apply);
    window.addEventListener('storage', sync);
    window.addEventListener('aiqc-theme-change', apply);
    return () => {
      media.removeEventListener('change', apply);
      window.removeEventListener('storage', sync);
      window.removeEventListener('aiqc-theme-change', apply);
    };
  }, []);
  function change(value: string) {
    const next = parseThemePreference(value);
    document.documentElement.dataset.themePreference = next;
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* Session-only preference is still usable. */ }
    window.dispatchEvent(new Event('aiqc-theme-change'));
  }
  return <label className="theme-switcher"><span aria-hidden="true">◐</span><span className="sr-only">界面主题</span><select aria-label="界面主题" value={preference} onChange={event => change(event.target.value)}><option value="light">白天</option><option value="dark">夜间</option><option value="system">跟随系统</option></select></label>;
}
