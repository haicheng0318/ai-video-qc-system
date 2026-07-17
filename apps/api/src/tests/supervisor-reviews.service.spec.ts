import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AiReviewStatus, UserRole, VideoStatus } from '@prisma/client';
import {
  SupervisorReviewDecision,
} from '../modules/supervisor-reviews/dto/create-supervisor-review.dto';
import { SupervisorReviewsService } from '../modules/supervisor-reviews/supervisor-reviews.service';
import { PrismaService } from '../modules/prisma/prisma.service';

const videoId = '00000000-0000-4000-8000-000000000020';
const reviewer = {
  id: 'admin-id',
  account: 'admin',
  name: 'Admin',
  role: UserRole.admin,
  managerId: null,
};

function createHarness(options: {
  missingVideo?: boolean;
  status?: VideoStatus;
  hasSucceededAi?: boolean;
  existingReview?: boolean;
  serialTransactions?: boolean;
} = {}) {
  const video = {
    id: videoId,
    creatorId: 'director-id',
    status: options.status || VideoStatus.pending_supervisor_review,
    creator: { managerId: 'supervisor-id' },
  };
  let review: Record<string, any> | null = options.existingReview ? {
    id: 'existing-review',
    videoId,
    reviewerId: reviewer.id,
    decision: SupervisorReviewDecision.ApprovedForPublish,
    comment: null,
    revisionRequirements: null,
    reviewedAt: new Date(),
    reviewer,
  } : null;
  const logs: Array<Record<string, unknown>> = [];
  const transaction = {
    $queryRaw: async () => [],
    video: {
      findUnique: async () => options.missingVideo ? null : video,
      update: async ({ data }: { data: { status: VideoStatus } }) => {
        video.status = data.status;
        return video;
      },
    },
    supervisorReview: {
      findUnique: async () => review,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        review = {
          id: 'new-review',
          ...data,
          reviewedAt: data.reviewedAt || new Date(),
          reviewer,
        };
        return review;
      },
    },
    aiContentReview: {
      findFirst: async () => options.hasSucceededAi === false ? null : {
        id: 'ai-review', status: AiReviewStatus.succeeded,
      },
    },
  };
  let queue = Promise.resolve();
  const runTransaction = async (callback: (client: typeof transaction) => Promise<unknown>) => {
    if (!options.serialTransactions) return callback(transaction);
    const result = queue.then(() => callback(transaction));
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
  const prisma = {
    video: { findUnique: async () => options.missingVideo ? null : video },
    supervisorReview: { findUnique: async () => review },
    $transaction: runTransaction,
  } as unknown as PrismaService;
  const permissions = {
    assertCanSubmitSupervisorReview: async () => undefined,
    assertCanAccessVideo: async () => undefined,
  };
  const operationLogs = { create: async (input: Record<string, unknown>) => logs.push(input) };
  const service = new SupervisorReviewsService(prisma, permissions as never, operationLogs as never);
  return { service, video, logs, getReview: () => review };
}

test('missing video returns 404', async () => {
  await assert.rejects(
    createHarness({ missingVideo: true }).service.create(videoId, { decision: SupervisorReviewDecision.ApprovedForPublish }, reviewer, {}),
    NotFoundException,
  );
});

test('non-pending-supervisor-review video returns 409', async () => {
  await assert.rejects(
    createHarness({ status: VideoStatus.submitted }).service.create(videoId, { decision: SupervisorReviewDecision.ApprovedForPublish }, reviewer, {}),
    ConflictException,
  );
});

test('missing succeeded Gemini review returns 409', async () => {
  await assert.rejects(
    createHarness({ hasSucceededAi: false }).service.create(videoId, { decision: SupervisorReviewDecision.ApprovedForPublish }, reviewer, {}),
    ConflictException,
  );
});

test('revision required without comment returns 400', async () => {
  await assert.rejects(
    createHarness().service.create(videoId, { decision: SupervisorReviewDecision.RevisionRequired }, reviewer, {}),
    BadRequestException,
  );
});

test('invalid content without reason returns 400', async () => {
  await assert.rejects(
    createHarness().service.create(videoId, { decision: SupervisorReviewDecision.InvalidContent }, reviewer, {}),
    BadRequestException,
  );
});

for (const [decision, status, action] of [
  [SupervisorReviewDecision.ApprovedForPublish, VideoStatus.approved_for_publish, 'supervisor_review_approved'],
  [SupervisorReviewDecision.RevisionRequired, VideoStatus.revision_required, 'supervisor_review_revision_required'],
  [SupervisorReviewDecision.InvalidContent, VideoStatus.invalid_content, 'supervisor_review_invalid_content'],
] as const) {
  test(`${decision} persists review, status and audit in one transaction`, async () => {
    const harness = createHarness();
    const result = await harness.service.create(videoId, {
      decision,
      comment: decision === SupervisorReviewDecision.ApprovedForPublish ? undefined : 'Required reason',
      revisionRequirements: decision === SupervisorReviewDecision.RevisionRequired ? ['前2秒展示产品'] : undefined,
    }, reviewer, {});
    assert.equal(result.decision, decision);
    assert.equal(harness.video.status, status);
    assert.equal(harness.logs[0].actionType, action);
    assert.equal(harness.logs[0].targetType, 'supervisor_review');
    assert.equal(harness.logs[0].result, 'success');
  });
}

test('duplicate review returns 409', async () => {
  await assert.rejects(
    createHarness({ existingReview: true }).service.create(videoId, { decision: SupervisorReviewDecision.ApprovedForPublish }, reviewer, {}),
    ConflictException,
  );
});

test('two concurrent reviews allow only one successful submission', async () => {
  const harness = createHarness({ serialTransactions: true });
  const submissions = await Promise.allSettled([
    harness.service.create(videoId, { decision: SupervisorReviewDecision.ApprovedForPublish }, reviewer, {}),
    harness.service.create(videoId, { decision: SupervisorReviewDecision.ApprovedForPublish }, reviewer, {}),
  ]);
  assert.equal(submissions.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(submissions.filter((item) => item.status === 'rejected').length, 1);
});

test('latest returns filtered review and never exposes internal fields', async () => {
  const harness = createHarness();
  await harness.service.create(videoId, {
    decision: SupervisorReviewDecision.RevisionRequired,
    comment: 'Revise',
    revisionRequirements: ['Shorten intro'],
  }, reviewer, {});
  const latest = await harness.service.latest(videoId, reviewer, {});
  assert.equal(latest?.decision, SupervisorReviewDecision.RevisionRequired);
  assert.deepEqual(latest?.revisionRequirements, ['Shorten intro']);
  assert.equal(Object.hasOwn(latest || {}, 'adjustedContentGrade'), false);
});
