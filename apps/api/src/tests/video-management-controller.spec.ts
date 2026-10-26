import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../modules/permissions/roles.decorator';
import { VideosController } from '../modules/videos/videos.controller';

test('video record-state routes are explicitly admin-only', () => {
  for (const action of ['hide', 'trash', 'restore'] as const) {
    assert.deepEqual(Reflect.getMetadata(ROLES_KEY, VideosController.prototype[action]), [UserRole.admin]);
  }
});
