import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { UserRole, VideoStatus, VideoType } from '@prisma/client';
import { PermissionsService, canManageResultData } from '../modules/permissions/permissions.service';

const actor = (role: UserRole) => ({ id: role, account: role, name: role, role, managerId: null });
const video = (videoType: VideoType, isForAds = false) => ({
  id: '00000000-0000-4000-8000-000000000050',
  creatorId: 'director',
  videoType,
  isForAds,
  status: VideoStatus.pending_result_data,
}) as never;

for (const role of [UserRole.admin, UserRole.content_owner]) {
  for (const type of Object.values(VideoType)) {
    test(`${role} can trigger GPT review for ${type}`, () => {
      assert.equal(canManageResultData(actor(role), video(type)), true);
    });
  }
}

for (const type of [VideoType.product_card, VideoType.organic, VideoType.brand_seeding]) {
  test(`operator can trigger GPT review for ${type}`, () => {
    assert.equal(canManageResultData(actor(UserRole.operator), video(type)), true);
  });
}

test('operator can trigger non-ad other but cannot trigger ad-owned types', () => {
  assert.equal(canManageResultData(actor(UserRole.operator), video(VideoType.other, false)), true);
  assert.equal(canManageResultData(actor(UserRole.operator), video(VideoType.other, true)), false);
  assert.equal(canManageResultData(actor(UserRole.operator), video(VideoType.qianchuan_ad, true)), false);
  assert.equal(canManageResultData(actor(UserRole.operator), video(VideoType.live_room_traffic, true)), false);
});

test('advertiser can trigger ad-owned types only', () => {
  assert.equal(canManageResultData(actor(UserRole.advertiser), video(VideoType.qianchuan_ad, true)), true);
  assert.equal(canManageResultData(actor(UserRole.advertiser), video(VideoType.live_room_traffic, true)), true);
  assert.equal(canManageResultData(actor(UserRole.advertiser), video(VideoType.other, true)), true);
  assert.equal(canManageResultData(actor(UserRole.advertiser), video(VideoType.organic, false)), false);
});

for (const role of [UserRole.supervisor, UserRole.director]) {
  test(`${role} cannot trigger GPT result review`, () => {
    assert.equal(canManageResultData(actor(role), video(VideoType.product_card)), false);
  });
}

test('denied GPT trigger writes permission_denied before returning 403', async () => {
  const logs: Array<Record<string, unknown>> = [];
  const service = new PermissionsService({} as never, {
    create: async (entry: Record<string, unknown>) => { logs.push(entry); },
  } as never);
  await assert.rejects(
    service.assertCanTriggerResultReview(actor(UserRole.director), video(VideoType.organic), {}),
    ForbiddenException,
  );
  assert.equal(logs.length, 1);
  assert.equal(logs[0].actionType, 'permission_denied');
  assert.equal(logs[0].result, 'denied');
  assert.equal(logs[0].targetType, 'video');
});
