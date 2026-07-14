import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { test } from 'node:test';
import { VideoStatus } from '@prisma/client';
import { VideoListQueryDto } from '../modules/videos/dto/video-list-query.dto';

const queryMetadata = {
  type: 'query',
  metatype: VideoListQueryDto,
  data: '',
} as const;

test('invalid VideoStatus query is rejected as a bad request', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });

  await assert.rejects(
    pipe.transform({ status: 'not-a-video-status' }, queryMetadata),
    (error: unknown) => error instanceof BadRequestException,
  );
});

test('valid VideoStatus query remains accepted', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });
  const result = await pipe.transform({ status: VideoStatus.submitted }, queryMetadata);

  assert.equal((result as VideoListQueryDto).status, VideoStatus.submitted);
});
