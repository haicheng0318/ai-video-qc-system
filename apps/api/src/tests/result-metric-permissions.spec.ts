import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { UserRole, VideoStatus, VideoType } from '@prisma/client';
import { PermissionsService } from '../modules/permissions/permissions.service';
import { AuthenticatedUser } from '../types/authenticated-user';

const user = (role: UserRole): AuthenticatedUser => ({ id: `${role}-id`, account: role, name: role, role, managerId: null });
const video = (creatorId: string) => ({
  id: '00000000-0000-4000-8000-000000000040', creatorId, videoType: VideoType.organic,
  isForAds: false, status: VideoStatus.approved_for_publish,
}) as Parameters<PermissionsService['assertCanSubmitResultMetrics']>[1];

function harness() {
  const logs: Array<Record<string, unknown>> = [];
  return { logs, service: new PermissionsService({} as never, { create: async (input: Record<string, unknown>) => logs.push(input) } as never) };
}

test('admin can submit result metrics for another user video', async () => {
  await assert.doesNotReject(harness().service.assertCanSubmitResultMetrics(user(UserRole.admin), video('another-user')));
});

for (const role of Object.values(UserRole).filter((role) => role !== UserRole.admin)) {
  test(`${role} can submit result metrics for own video`, async () => {
    const actor = user(role);
    await assert.doesNotReject(harness().service.assertCanSubmitResultMetrics(actor, video(actor.id)));
  });
  test(`${role} cannot submit result metrics for another user video`, async () => {
    await assert.rejects(harness().service.assertCanSubmitResultMetrics(user(role), video('another-user')), ForbiddenException);
  });
}

test('permission denial writes a denied operation log', async () => {
  const { service, logs } = harness();
  await assert.rejects(service.assertCanSubmitResultMetrics(user(UserRole.operator), video('another-user'), {}), ForbiddenException);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].actionType, 'permission_denied');
  assert.equal(logs[0].result, 'denied');
});
