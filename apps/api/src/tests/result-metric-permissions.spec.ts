import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { UserRole, VideoStatus, VideoType } from '@prisma/client';
import { PermissionsService } from '../modules/permissions/permissions.service';
import { AuthenticatedUser } from '../types/authenticated-user';

const user = (role: UserRole): AuthenticatedUser => ({
  id: `${role}-id`,
  account: role,
  name: role,
  role,
  managerId: null,
});

function video(videoType: VideoType, isForAds = false) {
  return {
    id: '00000000-0000-4000-8000-000000000040',
    videoType,
    isForAds,
    creatorId: 'director-id',
    status: VideoStatus.approved_for_publish,
  } as Parameters<PermissionsService['assertCanSubmitResultMetrics']>[1];
}

function harness() {
  const logs: Array<Record<string, unknown>> = [];
  const service = new PermissionsService(
    {} as never,
    { create: async (input: Record<string, unknown>) => logs.push(input) } as never,
  );
  return { service, logs };
}

for (const role of [UserRole.admin, UserRole.content_owner]) {
  for (const type of Object.values(VideoType)) {
    test(`${role} can submit result metrics for ${type}`, async () => {
      const { service } = harness();
      await assert.doesNotReject(
        service.assertCanSubmitResultMetrics(user(role), video(type, type === VideoType.other)),
      );
    });
  }
}

for (const type of [VideoType.product_card, VideoType.organic, VideoType.brand_seeding]) {
  test(`operator can submit ${type} result metrics`, async () => {
    await assert.doesNotReject(
      harness().service.assertCanSubmitResultMetrics(user(UserRole.operator), video(type)),
    );
  });
}

for (const type of [VideoType.qianchuan_ad, VideoType.live_room_traffic]) {
  test(`operator cannot submit ${type} result metrics`, async () => {
    await assert.rejects(
      harness().service.assertCanSubmitResultMetrics(user(UserRole.operator), video(type)),
      ForbiddenException,
    );
  });
}

for (const type of [VideoType.qianchuan_ad, VideoType.live_room_traffic]) {
  test(`advertiser can submit ${type} result metrics`, async () => {
    await assert.doesNotReject(
      harness().service.assertCanSubmitResultMetrics(user(UserRole.advertiser), video(type)),
    );
  });
}

test('advertiser cannot submit organic result metrics', async () => {
  await assert.rejects(
    harness().service.assertCanSubmitResultMetrics(
      user(UserRole.advertiser),
      video(VideoType.organic),
    ),
    ForbiddenException,
  );
});

for (const role of [UserRole.supervisor, UserRole.director]) {
  test(`${role} cannot submit result metrics`, async () => {
    await assert.rejects(
      harness().service.assertCanSubmitResultMetrics(
        user(role),
        video(VideoType.product_card),
      ),
      ForbiddenException,
    );
  });
}

test('other video responsibility follows isForAds', async () => {
  const operator = user(UserRole.operator);
  const advertiser = user(UserRole.advertiser);
  const service = harness().service;
  await assert.doesNotReject(
    service.assertCanSubmitResultMetrics(operator, video(VideoType.other, false)),
  );
  await assert.rejects(
    service.assertCanSubmitResultMetrics(operator, video(VideoType.other, true)),
    ForbiddenException,
  );
  await assert.doesNotReject(
    service.assertCanSubmitResultMetrics(advertiser, video(VideoType.other, true)),
  );
});

test('result metric permission denial writes a denied operation log', async () => {
  const { service, logs } = harness();
  await assert.rejects(
    service.assertCanSubmitResultMetrics(
      user(UserRole.director),
      video(VideoType.product_card),
      { ipAddress: '127.0.0.1', userAgent: 'test' },
    ),
    ForbiddenException,
  );
  assert.equal(logs.length, 1);
  assert.equal(logs[0].actionType, 'permission_denied');
  assert.equal(logs[0].result, 'denied');
  assert.equal(logs[0].videoId, '00000000-0000-4000-8000-000000000040');
});
