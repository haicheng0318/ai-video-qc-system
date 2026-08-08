import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UserRole } from '@prisma/client';
import { PermissionsService } from '../modules/permissions/permissions.service';

function harness() {
  const logs: any[] = [];
  return { logs, service: new PermissionsService({} as any, { create: async (value: any) => logs.push(value) } as any) };
}

for (const method of ['assertCanConfirmFinalEvaluation', 'assertCanMarkCase'] as const) {
  for (const role of Object.values(UserRole)) {
    test(`${role} ${method} permission`, async () => {
      const value = harness();
      const action = value.service[method]({ id: 'user', role, account: role, name: role, managerId: null }, { id: 'video' } as any);
      if ([UserRole.admin, UserRole.content_owner].includes(role as any)) {
        await action; assert.equal(value.logs.length, 0);
      } else {
        await assert.rejects(action); assert.equal(value.logs[0].actionType, 'permission_denied'); assert.equal(value.logs[0].result, 'denied');
      }
    });
  }
}
