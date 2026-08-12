import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VideoStatus } from '@prisma/client';
import { CasesService } from '../modules/cases/cases.service';

const user = { id: 'user', role: 'content_owner', account: 'owner', name: 'Owner', managerId: null } as any;
const videoId = '22222222-2222-4222-8222-222222222222';

function markHarness(options: Record<string, any> = {}) {
  const logs: any[] = []; const updates: any[] = [];
  const video = { id: 'video', status: options.videoStatus || VideoStatus.final_effective };
  const evaluation = {
    id: 'evaluation', videoId: 'video', status: 'succeeded', confirmedAt: new Date(),
    finalGrade: options.finalGrade || 'effective', finalStatus: options.finalStatus || 'final_effective',
    isExcellentCase: false, isNegativeCase: false, caseNote: null,
  };
  const tx: any = {
    $queryRaw: async () => [], video: { findUnique: async () => video },
    finalVideoEvaluation: {
      findFirst: async (args: any) => args.where?.id ? (options.missingEvaluation ? null : evaluation) : { id: options.latestId || evaluation.id },
      update: async (args: any) => { updates.push(args); return { ...evaluation, ...args.data, caseMarker: { id: user.id, name: user.name, account: user.account, role: user.role } }; },
    },
  };
  const prisma: any = { video: { findUnique: async () => options.outerMissing ? null : video }, $transaction: async (fn: any) => fn(tx) };
  return {
    service: new CasesService(prisma, { assertCanMarkCase: async () => undefined, buildVideoVisibilityWhere: () => ({}) } as any,
      { create: async (log: any, client: any) => { assert.equal(client, tx); logs.push(log); } } as any),
    logs, updates,
  };
}

for (const [caseType, grade, status, action] of [
  ['excellent', 'effective', VideoStatus.final_effective, 'excellent_case_marked'],
  ['negative', 'invalid', VideoStatus.final_invalid, 'negative_case_marked'],
  ['none', 'effective', VideoStatus.final_effective, 'case_mark_removed'],
] as const) {
  test(`${caseType} updates mutually exclusive flags and logs`, async () => {
    const value = markHarness({ finalGrade: grade, videoStatus: status, finalStatus: status });
    const result = await value.service.mark(videoId, { evaluationId: 'evaluation', caseType, reason: '完整的案例标记说明' }, user, {});
    assert.equal(result.isExcellentCase, caseType === 'excellent'); assert.equal(result.isNegativeCase, caseType === 'negative');
    assert.equal(value.logs[0].actionType, action); assert.equal(value.logs[0].result, 'success');
    assert.equal(result.videoStatus, status);
  });
}

for (const [name, options, caseType] of [
  ['excellent on invalid', { finalGrade: 'invalid', videoStatus: VideoStatus.final_invalid }, 'excellent'],
  ['negative on effective', { finalGrade: 'effective' }, 'negative'],
  ['excellent on low effective', { finalGrade: 'low_effective', videoStatus: VideoStatus.final_low_effective }, 'excellent'],
  ['negative on low effective', { finalGrade: 'low_effective', videoStatus: VideoStatus.final_low_effective }, 'negative'],
  ['non-final video', { videoStatus: VideoStatus.pending_final_confirmation }, 'none'],
  ['non-latest evaluation', { latestId: 'other' }, 'none'],
  ['missing evaluation', { missingEvaluation: true }, 'none'],
] as const) {
  test(`${name} rejects case marking`, async () => {
    const value = markHarness(options);
    await assert.rejects(value.service.mark(videoId, { evaluationId: 'evaluation', caseType: caseType as any, reason: '完整的案例标记说明' }, user, {}));
    assert.equal(value.updates.length, 0);
  });
}

test('case reason rejects HTML', async () => {
  const value = markHarness();
  await assert.rejects(value.service.mark(videoId, { evaluationId: 'evaluation', caseType: 'excellent', reason: '<b>unsafe</b>' }, user, {}));
});

function listHarness(records: any[] = []) {
  const calls: any[] = [];
  const prisma: any = { finalVideoEvaluation: {
    findFirst: async () => ({ id: 'cursor', caseMarkedAt: new Date() }),
    findMany: async (args: any) => { calls.push(args); return records; },
  } };
  return { calls, service: new CasesService(prisma, { buildVideoVisibilityWhere: () => ({ creatorId: 'visible' }) } as any, {} as any) };
}

for (const type of ['excellent', 'negative'] as const) {
  test(`${type} list applies case flag and visibility in database where`, async () => {
    const value = listHarness();
    await value.service.list({ type, limit: 20 }, user);
    const where = value.calls[0].where;
    assert.equal(where[type === 'excellent' ? 'isExcellentCase' : 'isNegativeCase'], true);
    assert.equal(where.video.creatorId, 'visible');
  });
}

test('case list is narrow and never exposes raw AI response', async () => {
  const value = listHarness([{
    id: 'evaluation', finalGrade: 'effective', finalStatus: 'final_effective', canBeUsedForPerformance: true,
    isExcellentCase: true, isNegativeCase: false, caseNote: 'note', caseMarkedAt: new Date(), confirmedAt: new Date(),
    rawResponse: { secret: true }, video: { id: 'video', title: 'title', creator: { name: 'Director' } }, caseMarker: { name: 'Owner' },
  }]);
  const response = await value.service.list({ type: 'excellent', limit: 20 }, user);
  assert.equal('rawResponse' in response.items[0], false); assert.equal(response.items[0].videoId, 'video');
});

test('history cursor pagination requests one extra row and returns next cursor', async () => {
  const rows = Array.from({ length: 3 }, (_, index) => ({
    id: `evaluation-${index}`, finalGrade: 'effective', finalStatus: 'final_effective', canBeUsedForPerformance: false,
    isExcellentCase: true, isNegativeCase: false, caseNote: 'note', caseMarkedAt: new Date(), confirmedAt: new Date(),
    video: { id: `video-${index}`, title: 'title', creator: { name: 'Director' } }, caseMarker: { name: 'Owner' },
  }));
  const value = listHarness(rows);
  const response = await value.service.list({ type: 'excellent', limit: 2, cursor: '123e4567-e89b-42d3-a456-426614174000' }, user);
  assert.equal(value.calls[0].take, 3); assert.equal(response.items.length, 2); assert.equal(response.nextCursor, 'evaluation-1');
});
