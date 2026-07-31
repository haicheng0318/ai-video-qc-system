import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { UserRole, Video, VideoStatus, VideoType } from '@prisma/client';
import { PermissionsService } from '../modules/permissions/permissions.service';
import { PrismaService } from '../modules/prisma/prisma.service';

const video = {
  id: '00000000-0000-4000-8000-000000000010',
  title: 'Video',
  creatorId: 'director-id',
  status: VideoStatus.pending_supervisor_review,
  videoType: VideoType.product_card,
  creator: { managerId: 'supervisor-id' },
} as unknown as Video & { creator: { managerId: string | null } };

function user(role: UserRole, id = `${role}-id`) {
  return { id, account: role, name: role, role, managerId: null };
}

function service() {
  const logs: Array<Record<string, unknown>> = [];
  const operationLogs = { create: async (input: Record<string, unknown>) => logs.push(input) };
  return {
    logs,
    permissions: new PermissionsService({} as PrismaService, operationLogs as never),
  };
}

test('admin can review any video', async () => {
  await assert.doesNotReject(service().permissions.assertCanSubmitSupervisorReview(user(UserRole.admin), video));
});

test('content owner can review any video', async () => {
  await assert.doesNotReject(service().permissions.assertCanSubmitSupervisorReview(user(UserRole.content_owner), video));
});

test('supervisor can review a direct report video', async () => {
  await assert.doesNotReject(service().permissions.assertCanSubmitSupervisorReview(user(UserRole.supervisor), video));
});

test('supervisor cannot review a non-direct-report video', async () => {
  const harness = service();
  await assert.rejects(
    harness.permissions.assertCanSubmitSupervisorReview(
      user(UserRole.supervisor),
      { ...video, creator: { managerId: 'another-supervisor' } },
    ),
    ForbiddenException,
  );
  assert.equal(harness.logs[0].result, 'denied');
});

for (const role of [UserRole.director, UserRole.operator, UserRole.advertiser]) {
  test(`${role} cannot submit supervisor review`, async () => {
    const harness = service();
    await assert.rejects(
      harness.permissions.assertCanSubmitSupervisorReview(user(role, 'director-id'), video),
      ForbiddenException,
    );
    assert.equal(harness.logs[0].actionType, 'permission_denied');
  });
}
