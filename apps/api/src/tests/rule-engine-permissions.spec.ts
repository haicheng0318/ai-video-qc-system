import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { UserRole, VideoStatus, VideoType } from '@prisma/client';
import { PermissionsService } from '../modules/permissions/permissions.service';

const actor = (role: UserRole) => ({ id: `${role}-id`, account: role, name: role, role, managerId: null });
const video = (creatorId: string) => ({ id: '00000000-0000-4000-8000-000000000202', creatorId, videoType: VideoType.organic, isForAds: false, status: VideoStatus.pending_rule_engine }) as never;

test('admin can execute rule engine globally', async () => {
  await new PermissionsService({} as never, { create: async () => undefined } as never).assertCanExecuteRuleEngine(actor(UserRole.admin), video('another-user'), {});
});

for (const role of Object.values(UserRole).filter((role) => role !== UserRole.admin)) {
  test(`${role} can execute rule engine for own video`, async () => {
    const user = actor(role);
    await new PermissionsService({} as never, { create: async () => undefined } as never).assertCanExecuteRuleEngine(user, video(user.id), {});
  });
}

test('another user is denied before rule execution and permission denial is logged', async () => {
  const logs: Array<Record<string, unknown>> = [];
  const service = new PermissionsService({} as never, { create: async (entry: Record<string, unknown>) => { logs.push(entry); } } as never);
  await assert.rejects(service.assertCanExecuteRuleEngine(actor(UserRole.director), video('another-user'), {}), ForbiddenException);
  assert.equal(logs[0].actionType, 'permission_denied');
  assert.equal(logs[0].result, 'denied');
});
