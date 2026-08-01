import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { UserRole, VideoStatus, VideoType } from '@prisma/client';
import { PermissionsService } from '../modules/permissions/permissions.service';

const actor = (role: UserRole) => ({ id: role, account: role, name: role, role, managerId: null });
const permissionVideoId = '00000000-0000-4000-8000-000000000202';
const video = {
  id: permissionVideoId, creatorId: 'director',
  videoType: VideoType.organic, isForAds: false, status: VideoStatus.pending_rule_engine,
} as never;

for (const role of [UserRole.admin, UserRole.content_owner]) {
  test(`${role} can execute the rule engine`, async () => {
    const service = new PermissionsService({} as never, { create: async () => undefined } as never);
    await service.assertCanExecuteRuleEngine(actor(role), video, {});
  });
}

for (const role of [UserRole.supervisor, UserRole.director, UserRole.operator, UserRole.advertiser]) {
  test(`${role} is denied before rule execution and writes permission_denied`, async () => {
    const logs: Array<Record<string, unknown>> = [];
    const service = new PermissionsService({} as never, {
      create: async (entry: Record<string, unknown>) => { logs.push(entry); },
    } as never);
    await assert.rejects(service.assertCanExecuteRuleEngine(actor(role), video, {
      ipAddress: '127.0.0.1', userAgent: 'test-agent',
    }), ForbiddenException);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].actionType, 'permission_denied');
    assert.equal(logs[0].result, 'denied');
    assert.equal(logs[0].targetType, 'video');
    assert.equal(logs[0].targetId, permissionVideoId);
  });
}
