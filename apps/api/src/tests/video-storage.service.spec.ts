import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finished } from 'node:stream/promises';
import { test } from 'node:test';
import { VideoStorageService } from '../modules/storage/video-storage.service';

const environmentNames = [
  'VIDEO_STORAGE_PROVIDER',
  'COS_REGION',
  'COS_BUCKET',
  'COS_VIDEO_PREFIX',
  'VIDEO_UPLOAD_TEMP_DIR',
] as const;

test('COS storage uploads privately, materializes for AI, signs reads and deletes objects', async () => {
  const previous = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));
  const directory = await mkdtemp(join(tmpdir(), 'ai-video-cos-test-'));
  const uploadPath = join(directory, 'upload.mp4');
  await writeFile(uploadPath, 'video-bytes');
  const calls: Array<{ action: string; params: Record<string, unknown> }> = [];
  const fakeCos = {
    putObject: async (params: Record<string, unknown>) => {
      calls.push({ action: 'put', params });
      const body = params.Body as NodeJS.ReadableStream;
      body.resume();
      await finished(body);
      return {};
    },
    deleteObject: async (params: Record<string, unknown>) => {
      calls.push({ action: 'delete', params });
      return {};
    },
    getObjectUrl: (params: Record<string, unknown>) => {
      calls.push({ action: 'sign', params });
      return 'https://private.example.test/signed-video';
    },
    getObject: async (params: Record<string, unknown>) => {
      calls.push({ action: 'get', params });
      const output = params.Output as NodeJS.WritableStream;
      output.end('downloaded-video');
      await finished(output);
      return {};
    },
    headObject: async (params: Record<string, unknown>) => {
      calls.push({ action: 'head', params });
      return { headers: { 'content-length': '11', 'content-type': 'video/mp4' } };
    },
  };

  Object.assign(process.env, {
    VIDEO_STORAGE_PROVIDER: 'cos',
    COS_REGION: 'ap-shanghai',
    COS_BUCKET: 'ai-video-qc-test-1234567890',
    COS_VIDEO_PREFIX: 'ai-video-qc/videos',
    VIDEO_UPLOAD_TEMP_DIR: directory,
  });

  try {
    const service = new VideoStorageService(fakeCos as never);
    const storedPath = await service.storeUploadedFile({
      path: uploadPath,
      mimetype: 'video/mp4',
      size: 11,
    });
    assert.match(storedPath, /^cos:\/\/ai-video-qc-test-1234567890\/ai-video-qc\/videos\/.+\.mp4$/);
    assert.equal(existsSync(uploadPath), false);
    assert.equal(calls[0].params.ACL, 'private');

    const signedUrl = await service.createReadUrl(storedPath);
    assert.equal(signedUrl, 'https://private.example.test/signed-video');
    assert.equal(calls.find((call) => call.action === 'sign')?.params.Sign, true);

    const ticket = await service.createDirectUpload('director-id', 'example.mp4', 'video/mp4', 11);
    assert.match(ticket.objectPath, /\/director-id\//);
    assert.equal(ticket.uploadUrl, 'https://private.example.test/signed-video');
    assert.equal(calls.filter((call) => call.action === 'sign').at(-1)?.params.Method, 'PUT');
    await service.verifyDirectUpload(ticket.objectPath, 'director-id', {
      mimeType: 'video/mp4',
      fileSizeBytes: 11,
    });
    assert.equal(calls.some((call) => call.action === 'head'), true);

    const materialized = await service.materialize(storedPath);
    assert.equal(await readFile(materialized.path, 'utf8'), 'downloaded-video');
    await materialized.cleanup();
    assert.equal(existsSync(materialized.path), false);

    await service.deleteStoredFile(storedPath);
    assert.equal(calls.at(-1)?.action, 'delete');
  } finally {
    for (const name of environmentNames) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
