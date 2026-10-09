import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { UserRole, VideoStatus, VideoType } from '@prisma/client';
import { PermissionsService, canManageResultData } from '../modules/permissions/permissions.service';

const actor = (role: UserRole) => ({ id: `${role}-id`, account: role, name: role, role, managerId: null });
const video = (creatorId: string) => ({ id: '00000000-0000-4000-8000-000000000050', creatorId, videoType: VideoType.organic, isForAds: false, status: VideoStatus.pending_result_data }) as never;

test('admin can trigger result review globally', () => {
  assert.equal(canManageResultData(actor(UserRole.admin), video('another-user')), true);
});

for (const role of Object.values(UserRole).filter((role) => role !== UserRole.admin)) {
  test(`${role} can trigger result review for own video only`, () => {
    const user = actor(role);
    assert.equal(canManageResultData(user, video(user.id)), true);
    assert.equal(canManageResultData(user, video('another-user')), false);
  });
}

test('denied result review trigger writes permission_denied before returning 403', async () => {
  const logs: Array<Record<string, unknown>> = [];
  const service = new PermissionsService({} as never, { create: async (entry: Record<string, unknown>) => { logs.push(entry); } } as never);
  await assert.rejects(service.assertCanTriggerResultReview(actor(UserRole.operator), video('another-user'), {}), ForbiddenException);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].actionType, 'permission_denied');
  assert.equal(logs[0].result, 'denied');
});
