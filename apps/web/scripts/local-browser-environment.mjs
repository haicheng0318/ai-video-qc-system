// Pure entry guard: call before locating tools, creating output, or launching
// browsers/servers. Never copy the caller's model keys, proxies or NODE_OPTIONS.
export function localBrowserEnvironment(env, baseKey, fallback) {
  if (env.QC_LOCAL_REHEARSAL !== '1') throw Error('Browser acceptance requires QC_LOCAL_REHEARSAL=1.');
  if (env.NODE_ENV === 'production') throw Error('Browser acceptance production mode is forbidden.');
  const base = env[baseKey] || fallback;
  let target;
  try { target = new URL(base); } catch {}
  if (!target || !['http:', 'https:'].includes(target.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || target.username || target.password) {
    throw Error('Browser acceptance requires a local HTTP(S) URL without credentials.');
  }
  const childEnv = Object.fromEntries(['PATH', 'HOME', 'LANG', 'TMPDIR']
    .filter(key => typeof env[key] === 'string').map(key => [key, env[key]]));
  Object.assign(childEnv, { NODE_ENV: 'development', QC_LOCAL_REHEARSAL: '1', QC_SKIP_DOTENV: '1',
    NEXT_PUBLIC_API_BASE_URL: '', NEXT_PUBLIC_VIDEO_UPLOAD_MODE: 'multipart', NEXT_TELEMETRY_DISABLED: '1' });
  return { base, target, childEnv };
}
