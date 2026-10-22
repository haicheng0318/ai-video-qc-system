import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { VideosController } from '../modules/videos/videos.controller';

test('legacy content review trigger is read-only and directs callers to V1.1', () => {
  const controller = new VideosController({} as any, {} as any);
  assert.throws(
    () => controller.contentReview('video-id', {} as any, {} as any),
    (error: unknown) => error instanceof ConflictException
      && /V1\.1 content review endpoint/.test(error.message),
  );
});
