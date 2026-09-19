import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VideoStorageService } from '../modules/storage/video-storage.service';
import COS = require('cos-nodejs-sdk-v5');
test('offline COS upload signature binds authoritative content length and private ACL', async () => {
  const before = { COS_BUCKET: process.env.COS_BUCKET, COS_REGION: process.env.COS_REGION, VIDEO_STORAGE_PROVIDER: process.env.VIDEO_STORAGE_PROVIDER };
  process.env.COS_BUCKET = 'test-bucket-1234567890'; process.env.COS_REGION = 'ap-test'; process.env.VIDEO_STORAGE_PROVIDER = 'cos';
  try {
    const storage = new VideoStorageService(new COS({ SecretId: 'offline-dummy-id', SecretKey: 'offline-dummy-key' }));
    const a = await storage.createDirectUpload('owner', 'test.mp4', 'video/mp4', 10);
    const signed = new URL(a.uploadUrl).searchParams;
    assert.match(signed.get('q-header-list') || '', /content-length/);
    assert.match(signed.get('q-header-list') || '', /x-cos-acl/);
    assert.equal((a.headers as Record<string, string>)['x-cos-acl'], 'private');
    assert.equal('Content-Length' in a.headers, false, 'browser sets content length from the File body');
  } finally { for (const [key, value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
test('direct finalization conditionally copies source ETag, verifies sealed bytes and removes only its failed destination', async () => {
  const before = { COS_BUCKET: process.env.COS_BUCKET, COS_REGION: process.env.COS_REGION };
  process.env.COS_BUCKET = 'test-bucket'; process.env.COS_REGION = 'test-region';
  let finalBytes = 10; const calls: any[] = []; const deletes: string[] = [];
  const client = {
    headObject: async ({ Key }: any) => ({ headers: { 'content-length': Key.includes('/sealed/') ? String(finalBytes) : '10', 'content-type': 'video/mp4', etag: '"source-etag"' } }),
    putObjectCopy: async (input: any) => { calls.push(input); return {}; },
    deleteObject: async ({ Key }: any) => { deletes.push(Key); },
  };
  const storage = new VideoStorageService(client as any) as any;
  try {
    assert.equal(typeof storage.finalizeDirectUpload, 'function', 'immutable direct upload finalizer required');
    const target = storage.allocateFinalPath('owner');
    await storage.finalizeDirectUpload('cos://test-bucket/ai-video-qc/videos/owner/source', 'owner', { mimeType: 'video/mp4', fileSizeBytes: 10 }, target);
    assert.equal(calls[0].CopySourceIfMatch, '"source-etag"'); assert.equal(calls[0].ACL, 'private');
    assert.ok(calls[0].Key.includes('/sealed/')); assert.equal(deletes.length, 0);
    finalBytes = 11;
    await assert.rejects(storage.finalizeDirectUpload('cos://test-bucket/ai-video-qc/videos/owner/source', 'owner', { mimeType: 'video/mp4', fileSizeBytes: 10 }, storage.allocateFinalPath('owner')), /size/);
    assert.equal(deletes.length, 1); assert.ok(deletes[0].includes('/sealed/'));
    client.putObjectCopy = async () => { throw Object.assign(new Error('source changed'), { statusCode: 412 }); };
    await assert.rejects(storage.finalizeDirectUpload('cos://test-bucket/ai-video-qc/videos/owner/source', 'owner', { mimeType: 'video/mp4', fileSizeBytes: 10 }, storage.allocateFinalPath('owner')), /source changed/);
    assert.equal(deletes.length, 2); assert.ok(deletes.every((key) => key.includes('/sealed/')));
  } finally { for (const [key, value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
