import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UserRole, VideoStatus, VideoType } from '@prisma/client';
import { allowedVideoActions } from '../modules/videos/video-actions';

const actor = (role: UserRole, id = 'actor') => ({ id, role, account: id, name: id, managerId: null });
const video = (status: VideoStatus, creatorId = 'creator') => ({ status, creatorId, videoType: VideoType.organic, isForAds: false });

test('server action list is status, ownership and role aware', () => {
  assert.deepEqual(allowedVideoActions(actor(UserRole.director, 'creator'), video(VideoStatus.submitted)), ['trigger_content_review', 'export_report']);
  assert.deepEqual(allowedVideoActions(actor(UserRole.supervisor, 'boss'), { ...video(VideoStatus.pending_supervisor_review), creatorManagerId: 'boss' }), ['submit_supervisor_review', 'export_report']);
  assert.deepEqual(allowedVideoActions(actor(UserRole.operator), video(VideoStatus.pending_result_data), { hasMetric: true }), ['submit_result_metrics', 'trigger_result_review', 'export_report']);
  assert.deepEqual(allowedVideoActions(actor(UserRole.director), video(VideoStatus.pending_result_data)), ['export_report']);
});

test('server action list keeps final suggestion and confirmation separate', () => {
  assert.deepEqual(allowedVideoActions(actor(UserRole.content_owner), video(VideoStatus.pending_final_evaluation), { ruleSufficient: true }), ['trigger_final_evaluation', 'export_report']);
  assert.deepEqual(allowedVideoActions(actor(UserRole.content_owner), video(VideoStatus.pending_final_confirmation), { finalSucceeded: true }), ['confirm_final_evaluation', 'export_report']);
});
