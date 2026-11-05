export type ThemePreference = 'light' | 'dark' | 'system';
export const THEME_STORAGE_KEY = 'aiqc-ui-theme';
export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}
export function resolveTheme(preference: ThemePreference, darkSystem: boolean): 'light' | 'dark' {
  return preference === 'system' ? darkSystem ? 'dark' : 'light' : preference;
}
// Runs before paint; storage failure must never interrupt authentication or rendering.
export const THEME_INIT_SCRIPT = `(()=>{let p='system';try{p=localStorage.getItem('aiqc-ui-theme')||p}catch{}if(!['light','dark','system'].includes(p))p='system';const d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.dataset.themePreference=p;document.documentElement.style.colorScheme=d?'dark':'light'})()`;
