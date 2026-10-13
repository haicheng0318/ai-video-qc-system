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
  test(`${role} can trigger final evaluation for own video and admin can trigger globally`, async () => {
    const harness = service();
    const action = harness.permissions.assertCanTriggerFinalEvaluation(
      { id: 'user', role, account: role, name: role, managerId: null }, { id: 'video', creatorId: role === UserRole.admin ? 'another-user' : 'user' } as any,
    );
    await action;
    assert.equal(harness.logs.length, 0);
  });
}
