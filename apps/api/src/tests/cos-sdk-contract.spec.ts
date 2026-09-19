import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import COS = require('cos-nodejs-sdk-v5');
import { VideoStorageService } from '../modules/storage/video-storage.service';

const bucket = 'local-contract-1234567890';
const region = 'ap-shanghai';
const prefix = 'ai-video-qc/videos';
const secret = 'synthetic-local-signing-key';
const bytes = Buffer.from('video-bytes');
const environment = ['VIDEO_STORAGE_PROVIDER', 'COS_BUCKET', 'COS_REGION', 'COS_VIDEO_PREFIX',
  'COS_SIGNED_URL_TTL_SECONDS', 'VIDEO_UPLOAD_TEMP_DIR'] as const;

// Independent reconstruction of the COS SHA1 signature. Changing method, key,
// signed byte count or private ACL must no longer match the issued signature.
function signature(url: URL, method: string, headers: Record<string, string>) {
  const query = url.searchParams;
  const headerString = query.get('q-header-list')!.split(';').map(name =>
    `${encodeURIComponent(name)}=${encodeURIComponent(headers[name])}`).join('&');
  const httpString = `${method.toLowerCase()}\n${decodeURIComponent(url.pathname)}\n\n${headerString}\n`;
  const keyTime = query.get('q-key-time')!;
  const signKey = createHmac('sha1', secret).update(keyTime).digest('hex');
  const toSign = `sha1\n${keyTime}\n${createHash('sha1').update(httpString).digest('hex')}\n`;
  return createHmac('sha1', signKey).update(toSign).digest('hex');
}

async function fixture(run: (storage: VideoStorageService, client: COS, state: {
  directory: string; requests: Array<{ method: string; path: string; headers: Record<string, string | string[] | undefined>; body: Buffer }>;
  failCopy: boolean;
}) => Promise<void>) {
  const previous = Object.fromEntries(environment.map(name => [name, process.env[name]]));
  const directory = await mkdtemp(join(tmpdir(), 'ai-qc-cos-sdk-contract-'));
  const state = { directory, requests: [] as Array<{ method: string; path: string; headers: Record<string, string | string[] | undefined>; body: Buffer }>, failCopy: false };
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    state.requests.push({ method: request.method!, path: request.url!, headers: request.headers, body: Buffer.concat(chunks) });
    response.setHeader('x-cos-request-id', 'local-contract-request');
    if (request.method === 'HEAD') {
      response.writeHead(200, { 'content-length': bytes.length, 'content-type': 'video/mp4', etag: '"fixture-etag"' });
      response.end();
    } else if (request.headers['x-cos-copy-source']) {
      response.writeHead(state.failCopy ? 412 : 200, { 'content-type': 'application/xml' });
      response.end(state.failCopy
        ? '<Error><Code>PreconditionFailed</Code><Message>Source changed</Message></Error>'
        : '<CopyObjectResult><ETag>"fixture-etag"</ETag><LastModified>2026-09-10T00:00:00.000Z</LastModified></CopyObjectResult>');
    } else if (request.method === 'GET') {
      response.writeHead(200, { 'content-length': bytes.length, 'content-type': 'video/mp4' });
      response.end(bytes);
    } else {
      response.writeHead(request.method === 'DELETE' ? 204 : 200, { etag: '"fixture-etag"' });
      response.end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const client = new COS({ SecretId: 'local-contract-id', SecretKey: secret, Protocol: 'http:',
    Domain: `127.0.0.1:${port}`, AutoSwitchHost: false, FollowRedirect: false, Proxy: '',
    Timeout: 2000, ChunkRetryTimes: 0, ConfCwd: directory });
  // A real SDK with only its transport endpoint replaced. Refuse any fallback
  // host before the SDK opens a connection; no supplier service is contacted.
  client.on('before-send', (options: { url: string }) => {
    assert.equal(new URL(options.url).origin, `http://127.0.0.1:${port}`);
  });
  Object.assign(process.env, { VIDEO_STORAGE_PROVIDER: 'cos', COS_BUCKET: bucket, COS_REGION: region,
    COS_VIDEO_PREFIX: prefix, COS_SIGNED_URL_TTL_SECONDS: '99999', VIDEO_UPLOAD_TEMP_DIR: directory });
  try { await run(new VideoStorageService(client), client, state); }
  finally {
    for (const name of environment) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}

test('real COS SDK preserves signed GET lifetime and PUT byte-count/private-ACL binding', async () => {
  await fixture(async () => {
    // Signing performs no network calls and uses the same host as production.
    const storage = new VideoStorageService(new COS({ SecretId: 'local-contract-id', SecretKey: secret }));
    const read = new URL(await storage.createReadUrl(`cos://${bucket}/${prefix}/director/video.mp4`));
    assert.equal(read.protocol, 'https:');
    assert.equal(read.host, `${bucket}.cos.${region}.myqcloud.com`);
    const [start, end] = read.searchParams.get('q-sign-time')!.split(';').map(Number);
    assert.equal(end - start, 900);
    assert.equal(read.searchParams.get('q-signature'), signature(read, 'GET', { host: read.host }));
    assert.notEqual(read.searchParams.get('q-signature'), signature(read, 'PUT', { host: read.host }));
    const ticket = await storage.createDirectUpload('director', 'video.mp4', 'video/mp4', bytes.length,
      '00000000-0000-4000-8000-000000000001', 120);
    const upload = new URL(ticket.uploadUrl);
    const headers = { host: upload.host, 'content-length': '11', 'x-cos-acl': 'private' };
    assert.equal(upload.searchParams.get('q-header-list'), 'content-length;host;x-cos-acl');
    assert.equal(upload.searchParams.get('q-signature'), signature(upload, 'PUT', headers));
    assert.notEqual(upload.searchParams.get('q-signature'), signature(upload, 'PUT', { ...headers, 'content-length': '12' }));
    assert.notEqual(upload.searchParams.get('q-signature'), signature(upload, 'PUT', { ...headers, 'x-cos-acl': 'public-read' }));
    assert.deepEqual(ticket.headers, { 'Content-Type': 'video/mp4', 'x-cos-acl': 'private' });
    assert.equal(ticket.expiresInSeconds, 120);
  });
});

test('real COS SDK awaits streamed upload/download and preserves conditional sealing headers', async () => {
  await fixture(async (storage, client, state) => {
    const uploadPath = join(state.directory, 'upload.mp4');
    await writeFile(uploadPath, bytes);
    const stored = await storage.storeUploadedFile({ path: uploadPath, size: bytes.length, mimetype: 'video/mp4' });
    assert.equal(existsSync(uploadPath), false);
    const upload = state.requests[0];
    assert.equal(upload.method, 'PUT');
    assert.deepEqual(upload.body, bytes);
    assert.equal(upload.headers['content-length'], '11');
    assert.equal(upload.headers['content-type'], 'video/mp4');
    assert.equal(upload.headers['x-cos-acl'], 'private');
    const materialized = await storage.materialize(stored);
    assert.deepEqual(await readFile(materialized.path), bytes);
    await materialized.cleanup();
    assert.equal(existsSync(materialized.path), false);
    const source = `cos://${bucket}/${prefix}/director/source.mp4`;
    const target = `cos://${bucket}/${prefix}/sealed/director/target.mp4`;
    assert.equal(await storage.finalizeDirectUpload(source, 'director', { mimeType: 'video/mp4', fileSizeBytes: 11 }, target), target);
    const copy = state.requests.find(request => request.headers['x-cos-copy-source'])!;
    assert.equal(copy.headers['x-cos-copy-source'], `${bucket}.cos.${region}.myqcloud.com/${prefix}/director/source.mp4`);
    assert.equal(copy.headers['x-cos-copy-source-if-match'], '"fixture-etag"');
    assert.equal(copy.headers['x-cos-acl'], 'private');
    assert.equal(copy.headers['x-cos-metadata-directive'], 'Copy');
    const signedHeaders = new URLSearchParams(String(copy.headers.authorization)).get('q-header-list')!.split(';');
    for (const name of ['x-cos-copy-source', 'x-cos-copy-source-if-match', 'x-cos-acl', 'x-cos-metadata-directive']) assert.ok(signedHeaders.includes(name));
    // The application uses the Promise overload. Keep the SDK's callback result
    // contract exercised too, since its wrapper supplies those Promise results.
    await new Promise<void>((resolve, reject) => client.headObject({ Bucket: bucket, Region: region, Key: `${prefix}/director/source.mp4` }, (error, result) => {
      if (error) return reject(error);
      try { assert.equal(result.headers?.['content-length'], '11'); resolve(); } catch (failure) { reject(failure); }
    }));
  });
});

test('real COS SDK rejects failed source precondition and cleanup deletes only allocated destination', async () => {
  await fixture(async (storage, _client, state) => {
    state.failCopy = true;
    const source = `cos://${bucket}/${prefix}/director/source.mp4`;
    const target = `cos://${bucket}/${prefix}/sealed/director/target.mp4`;
    await assert.rejects(storage.finalizeDirectUpload(source, 'director', { mimeType: 'video/mp4', fileSizeBytes: 11 }, target),
      (error: { statusCode?: number; code?: string }) => error.statusCode === 412 && error.code === 'PreconditionFailed');
    const deletions = state.requests.filter(request => request.method === 'DELETE');
    assert.equal(deletions.length, 1);
    assert.equal(deletions[0].path, `/${prefix}/sealed/director/target.mp4`);
  });
});
