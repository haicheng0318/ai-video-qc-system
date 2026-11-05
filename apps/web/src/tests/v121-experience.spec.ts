import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const root = resolve(__dirname, '../..');
test('pre-paint theme bootstrap handles storage denial and invalid values', async () => {
  const { THEME_INIT_SCRIPT } = await import('../lib/theme');
  for (const value of ['light', 'dark', 'system', 'invalid', null, 'throws']) {
    const element = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
    runInNewContext(THEME_INIT_SCRIPT, { document: { documentElement: element }, localStorage: { getItem: () => { if (value === 'throws') throw Error('blocked'); return value; } }, matchMedia: () => ({ matches: true }) });
    assert.equal(element.dataset.theme, value === 'light' ? 'light' : 'dark');
    assert.equal(element.style.colorScheme, element.dataset.theme);
  }
});
test('theme supports explicit preferences and safe system fallback', async () => {
  const path = resolve(root, 'src/lib/theme.ts');
  assert.ok(existsSync(path), 'shared theme module must exist');
  const { resolveTheme, parseThemePreference } = await import('../lib/theme');
  assert.equal(parseThemePreference('invalid'), 'system');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});
test('all three themes have semantic surfaces and reduced motion protection', () => {
  const css = readFileSync(resolve(root, 'app/globals.css'), 'utf8') + readFileSync(resolve(root, 'app/experience.css'), 'utf8');
  assert.match(css, /data-theme=.?dark/);
  assert.match(css, /--chart-primary/);
  assert.match(css, /prefers-reduced-motion/);
  const layout = readFileSync(resolve(root, 'app/layout.tsx'), 'utf8');
  assert.match(layout, /THEME_INIT_SCRIPT/);
});
test('diagnostics keep all evidence in accessible disclosures and use suggestions not severity', () => {
  const source = readFileSync(resolve(root, 'src/components/v11-content-diagnostics.tsx'), 'utf8');
  assert.match(source, /<details/);
  assert.match(source, /<summary/);
  assert.match(source, /improvementSuggestions/);
  assert.match(source, /startSeconds/);
  assert.match(source, /建议处理顺序/);
});
