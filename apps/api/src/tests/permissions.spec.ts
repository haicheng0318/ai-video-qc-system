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

test('phase 1 video visibility keeps role ownership rules', () => {
  const service = new PermissionsService({} as PrismaService, {} as OperationLogsService);

  assert.deepEqual(service.buildVideoVisibilityWhere(user(UserRole.admin)), {});
  assert.deepEqual(service.buildVideoVisibilityWhere(user(UserRole.director)), {
    creatorId: 'director-id',
  });
  assert.deepEqual(service.buildVideoVisibilityWhere(user(UserRole.supervisor)), {
    OR: [
      { creatorId: 'director-id' },
      { creator: { managerId: 'director-id' } },
    ],
  });
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
      creator: { managerId: null },
    } as Parameters<PermissionsService['assertCanAccessVideo']>[1]),
    (error: unknown) => error instanceof ForbiddenException,
  );

  assert.equal(logInput?.result, 'denied');
  assert.equal(logInput?.targetType, 'video');
  assert.equal(logInput?.targetId, 'video-id');
});
