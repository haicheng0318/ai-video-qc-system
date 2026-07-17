import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { VideosController } from '../modules/videos/videos.controller';

test('content review trigger endpoint returns HTTP 202', () => {
  const statusCode = Reflect.getMetadata(
    HTTP_CODE_METADATA,
    VideosController.prototype.contentReview,
  );
  assert.equal(statusCode, 202);
});
