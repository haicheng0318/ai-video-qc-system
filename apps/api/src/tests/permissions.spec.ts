import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { test } from 'node:test';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../types/authenticated-user';
import { PermissionsService } from '../modules/permissions/permissions.service';
import { OperationLogsService } from '../modules/operation-logs/operation-logs.service';
import { PrismaService } from '../modules/prisma/prisma.service';

const user = (role: UserRole, id = 'director-id'): AuthenticatedUser => ({
  id,
  account: id,
  name: id,
  role,
  managerId: null,
});

test('V1.1 video visibility gives admin all data and every non-admin only own data', () => {
  const service = new PermissionsService({} as PrismaService, {} as OperationLogsService);

  assert.deepEqual(service.buildVideoVisibilityWhere(user(UserRole.admin)), {});
  assert.deepEqual(service.buildVideoVisibilityWhere(user(UserRole.director)), {
    creatorId: 'director-id',
    recordState: 'active',
  });
  assert.deepEqual(service.buildVideoVisibilityWhere(user(UserRole.supervisor)), {
    creatorId: 'director-id',
    recordState: 'active',
  });
  assert.deepEqual(service.buildVideoVisibilityWhere(user(UserRole.content_owner)), { creatorId: 'director-id', recordState: 'active' });
});

test('ordinary users cannot access hidden or trashed videos even when they own them', async () => {
  const logs: Record<string, unknown>[] = [];
  const service = new PermissionsService({} as PrismaService, { create: async (input: Record<string, unknown>) => { logs.push(input); } } as unknown as OperationLogsService);
  for (const recordState of ['hidden', 'trashed']) {
    await assert.rejects(service.assertCanAccessVideo(user(UserRole.director), { id: 'v', creatorId: 'director-id', recordState } as any), ForbiddenException);
  }
  assert.equal(logs.length, 2);
});

test('denied video access is logged and rejected', async () => {
  let logInput: Record<string, unknown> | undefined;
  const operationLogs = {
    create: async (input: Record<string, unknown>) => {
      logInput = input;
    },
  };
  const service = new PermissionsService(
    {} as PrismaService,
    operationLogs as unknown as OperationLogsService,
  );

  await assert.rejects(
    service.assertCanAccessVideo(user(UserRole.director, 'other-user'), {
      id: 'video-id',
      creatorId: 'owner-id',
      recordState: 'active',
      creator: { managerId: null },
    } as Parameters<PermissionsService['assertCanAccessVideo']>[1]),
    (error: unknown) => error instanceof ForbiddenException,
  );

  assert.equal(logInput?.result, 'denied');
  assert.equal(logInput?.targetType, 'video');
  assert.equal(logInput?.targetId, 'video-id');
});
