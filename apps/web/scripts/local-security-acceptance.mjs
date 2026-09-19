import assert from 'node:assert/strict';

const base = new URL(process.env.RELEASE_BROWSER_BASE_URL || 'http://127.0.0.1:3107');
if (process.env.QC_LOCAL_REHEARSAL !== '1' || process.env.NODE_ENV === 'production' || base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password) {
  throw Error('Security acceptance requires explicit local-only opt-in and a loopback fixture.');
}
// Benign requests prove that this unused processing endpoint is closed before
// input decoding. This is not an exploit payload or an external image request.
for (const query of ['', '?url=%2Fdoes-not-exist.avif&w=64&q=75']) {
  const response = await fetch(new URL(`/_next/image${query}`, base), { redirect: 'error', signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 404, 'unused image optimization API must be disabled');
}
console.log('PASS: unused image optimization API returns 404 for both benign probes; no external URLs requested.');
