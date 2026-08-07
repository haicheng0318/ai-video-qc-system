import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UserRole } from '@prisma/client';
import { PermissionsService } from '../modules/permissions/permissions.service';

function service() {
  const logs: any[] = [];
  return {
    logs,
    permissions: new PermissionsService({} as any, { create: async (value: any) => { logs.push(value); } } as any),
  };
}

for (const role of Object.values(UserRole)) {
  test(`${role} ${['admin', 'content_owner'].includes(role) ? 'can' : 'cannot'} trigger final evaluation`, async () => {
    const harness = service();
    const action = harness.permissions.assertCanTriggerFinalEvaluation(
      { id: 'user', role, account: role, name: role, managerId: null }, { id: 'video' } as any,
    );
    if (role === UserRole.admin || role === UserRole.content_owner) {
      await action;
      assert.equal(harness.logs.length, 0);
    } else {
      await assert.rejects(action);
      assert.equal(harness.logs[0].actionType, 'permission_denied');
      assert.equal(harness.logs[0].result, 'denied');
    }
  });
}
