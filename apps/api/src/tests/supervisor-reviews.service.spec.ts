import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { UserRole, VideoStatus } from '@prisma/client';
import { SupervisorReviewDecision } from '../modules/supervisor-reviews/dto/create-supervisor-review.dto';
import { SupervisorReviewsService } from '../modules/supervisor-reviews/supervisor-reviews.service';
import { PrismaService } from '../modules/prisma/prisma.service';

const videoId = '00000000-0000-4000-8000-000000000020';
const actor = { id: 'admin-id', account: 'admin', name: 'Admin', role: UserRole.admin, managerId: null };
const historicalReview = {
  id: 'historical-review', videoId, v11ContentDecisionId: null,
  decision: 'approved_for_publish', comment: '历史记录', revisionRequirements: null,
  reviewedAt: new Date('2026-01-01T00:00:00Z'),
  reviewer: { id: 'reviewer', name: '历史主管', account: 'reviewer', role: 'supervisor' },
};

function createHarness() {
  const events: string[] = [];
  const prisma = {
    video: { findUnique: async () => { events.push('video-read'); return { id: videoId, creatorId: actor.id, status: VideoStatus.pending_supervisor_review }; } },
    supervisorReview: { findUnique: async () => { events.push('review-read'); return historicalReview; } },
  } as unknown as PrismaService;
  const permissions = { assertCanAccessVideo: async () => undefined };
  const operationLogs = { create: async () => { events.push('audit'); } };
  return { service: new SupervisorReviewsService(prisma, permissions as never, operationLogs as never), events };
}

test('legacy supervisor POST returns the compatibility 409 without reading or mutating business state', async () => {
  const harness = createHarness();
  await assert.rejects(
    harness.service.create(videoId, { decision: SupervisorReviewDecision.ApprovedForPublish }, actor, {}),
    (error: unknown) => error instanceof ConflictException && error.message === '当前版本已取消日常人工内容审核。',
  );
  assert.deepEqual(harness.events, []);
});

test('historical supervisor review remains readable and auditable', async () => {
  const harness = createHarness();
  const result = await harness.service.latest(videoId, actor, {});
  assert.equal(result?.id, historicalReview.id);
  assert.equal(result?.decision, 'approved_for_publish');
  assert.equal(result?.comment, '历史记录');
  assert.equal(result?.reviewer.name, '历史主管');
  assert.deepEqual(harness.events, ['video-read', 'review-read', 'audit']);
});
