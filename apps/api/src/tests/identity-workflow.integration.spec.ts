import 'reflect-metadata';
import { assertIsolatedDatabase } from '../test-support/local-acceptance';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { QuotasService } from '../modules/quotas/quotas.service';
import { EvaluationJobsService } from '../modules/evaluation-jobs/evaluation-jobs.service';
import { PermissionsService } from '../modules/permissions/permissions.service';
import { OperationLogsService } from '../modules/operation-logs/operation-logs.service';
import { VideosService } from '../modules/videos/videos.service';
import { mkdtemp, writeFile, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.env.IDENTITY_TEST_DATABASE_URL;
if (url) assertIsolatedDatabase(url);
test('local uploads use actual bytes and duplicate operation keys do not charge twice', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url }), quotas = new QuotasService(db as any);
  const actor = await db.user.create({ data: { account: randomUUID(), name: 'Local upload', role: 'director', passwordHash: 'unused' } });
  await db.$transaction(async (tx) => { for (const [kind, limit] of [['upload_count', 2], ['storage_bytes', 10]] as const) await quotas.adjust(tx, actor.id, { kind, period: 'lifetime', limit, reason: 'test', businessKey: randomUUID() }, actor.id); });
  const directory = await mkdtemp(join(tmpdir(), 'identity-upload-'));
  const storage = { storeUploadedFile: async (file: any) => file.path, deleteStoredFile: (path: string) => unlink(path) };
  const logs = new OperationLogsService(db as any);
  const videos = new VideosService(db as any, new PermissionsService(db as any, logs), logs, storage as any, quotas);
  const file = async (name: string) => { const path = join(directory, name); await writeFile(path, '1234567890'); return { path, originalname: 'test.mp4', mimetype: 'video/mp4', size: 1 } as Express.Multer.File; };
  try {
    const uploadKey = randomUUID(), input = { title: 'Local', videoType: 'other' as const };
    const a = await videos.create(input, await file('a.mp4'), actor, { uploadKey });
    const b = await videos.create(input, await file('b.mp4'), actor, { uploadKey });
    assert.equal(a.id, b.id); assert.equal(a.fileSizeBytes, '10');
    await assert.rejects(videos.create(input, await file('c.mp4'), actor, { uploadKey: randomUUID() }), /quota/i);
    const summary = await quotas.summary(actor.id);
    assert.equal(summary.quotas.find((q) => q.kind === 'upload_count')!.used, 1);
    assert.equal(summary.quotas.find((q) => q.kind === 'storage_bytes')!.used, 10);
  } finally { await db.$disconnect(); await rm(directory, { recursive: true, force: true }); }
});
test('content queue reservations are transactional and charged only at external boundary; expired visitor never dispatched', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  const quotas = new QuotasService(db as any);
  const logs = new OperationLogsService(db as any); const permissions = new PermissionsService(db as any, logs);
  const jobs = new (EvaluationJobsService as any)(db, permissions, quotas);
  const actor = await db.user.create({ data: { account: randomUUID(), name: 'Queue quota', role: 'visitor', passwordHash: 'unused', expiresAt: new Date(Date.now() + 60000) } });
  await db.$transaction((tx) => quotas.adjust(tx, actor.id, { kind: 'content_evaluations', period: 'daily', limit: 2, reason: 'test', businessKey: randomUUID() }, actor.id));
  const fixture = async () => {
    const video = await db.video.create({ data: { creatorId: actor.id, isTrial: true, title: 'Trial', originalFileName: 'test.mp4', filePath: 'unused', mimeType: 'video/mp4', fileSizeBytes: 1, videoType: 'other', status: 'ai_content_reviewing' } });
    const review = await db.aiContentReview.create({ data: { videoId: video.id, status: 'running', modelProvider: 'test', modelName: 'test' } });
    return { videoId: video.id, actorId: actor.id, stage: 'content', contentReviewId: review.id };
  };
  const amount = async (field: 'used' | 'reserved') => (await quotas.summary(actor.id)).quotas.find((q) => q.kind === 'content_evaluations')![field];
  try {
    const first = await fixture();
    await assert.rejects(db.$transaction(async (tx) => { await jobs.enqueue(tx, first); throw Error('rollback'); }), /rollback/);
    assert.equal(await amount('reserved'), 0);
    const job = await db.$transaction((tx) => jobs.enqueue(tx, first));
    assert.equal(await amount('reserved'), 1, 'enqueue must reserve business quota in transaction');
    const lease = await jobs.claim('quota-test'); assert.equal(lease.job.id, (job as any).id);
    await db.user.update({ where: { id: actor.id }, data: { expiresAt: new Date(0) } });
    await assert.rejects(jobs.runWithLease(lease, () => jobs.markExternalStarted()), /expired|unavailable/i);
    assert.equal((await db.evaluationJob.findUnique({ where: { id: lease.job.id } }))?.externalStartedAt, null);
    await jobs.runWithLease(lease, () => db.$transaction((tx) => jobs.finishCurrent(tx, 'failed')));
    assert.equal(await amount('reserved'), 0); assert.equal(await amount('used'), 0);
    await db.user.update({ where: { id: actor.id }, data: { expiresAt: new Date(Date.now() + 60000) } });
    const second = await fixture(); await db.$transaction((tx) => jobs.enqueue(tx, second));
    const external = await jobs.claim('quota-test'); await jobs.runWithLease(external, () => jobs.markExternalStarted());
    await jobs.runWithLease(external, () => db.$transaction((tx) => jobs.finishCurrent(tx, 'failed', true)));
    assert.equal(await amount('used'), 1); assert.equal(await amount('reserved'), 0);
  } finally { await db.evaluationJob.updateMany({ where: { actorId: actor.id, status: { in: ['queued', 'running', 'retry_wait'] } }, data: { status: 'failed', leaseToken: null, leaseExpiresAt: null } }); await db.$disconnect(); }
});

test('direct upload tickets reserve atomically, confirm idempotently, mark trial and never delete confirmed objects', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url }), quotas = new QuotasService(db as any);
  const logs = new OperationLogsService(db as any), permissions = new PermissionsService(db as any, logs);
  const actor = await db.user.create({ data: { account: randomUUID(), name: 'Upload quota', role: 'visitor', passwordHash: 'unused', expiresAt: new Date(Date.now() + 3600000) } });
  await db.$transaction(async (tx) => { for (const [kind, limit] of [['upload_count', 1], ['storage_bytes', 10]] as const) await quotas.adjust(tx, actor.id, { kind, period: 'lifetime', limit, reason: 'test', businessKey: randomUUID() }, actor.id); });
  const deleted: string[] = [];
  const storage = {
    isCosEnabled: () => true,
    allocateFinalPath: () => `cos://test/sealed/${randomUUID()}`,
    finalizeDirectUpload: async (_source: string, _user: string, _expected: unknown, target: string) => target,
    createDirectUpload: async (_user: string, _name: string, _type: string, _size: number, operationId?: string) => ({ objectPath: `cos://test/${actor.id}/${operationId || randomUUID()}`, uploadUrl: 'https://test.invalid', expiresInSeconds: 900, fileSizeBytes: 10, headers: {} }),
    verifyDirectUpload: async () => undefined,
    deleteStoredFile: async (path: string) => { deleted.push(path); }, isCosPath: () => true,
  };
  const videos = new (VideosService as any)(db, permissions, logs, storage, quotas);
  try {
    const requestKey = randomUUID();
    const ticket = await videos.createDirectUploadTicket({ fileName: 'test.mp4', mimeType: 'video/mp4', fileSizeBytes: 10 }, actor, requestKey);
    const replay = await videos.createDirectUploadTicket({ fileName: 'test.mp4', mimeType: 'video/mp4', fileSizeBytes: 10 }, actor, requestKey);
    assert.equal(replay.ticketId, ticket.ticketId); assert.equal(replay.objectPath, ticket.objectPath);
    assert.equal((await quotas.summary(actor.id)).quotas.find((q) => q.kind === 'upload_count')!.reserved, 1, 'ticket must reserve before upload authorization');
    await assert.rejects(videos.createDirectUploadTicket({ fileName: 'second.mp4', mimeType: 'video/mp4', fileSizeBytes: 10 }, actor), /quota/i);
    const input = { objectPath: ticket.objectPath, mimeType: 'video/mp4', fileSizeBytes: 10, originalFileName: 'test.mp4', title: 'Trial', videoType: 'other' };
    const results = await Promise.all([videos.createDirect(input, actor, {}), videos.createDirect(input, actor, {})]);
    assert.equal(results[0].id, results[1].id); assert.equal(results[0].isTrial, true);
    assert.equal(deleted.length, 0);
    assert.equal((await quotas.summary(actor.id)).quotas.find((q) => q.kind === 'storage_bytes')!.used, 10);
    await db.user.update({ where: { id: actor.id }, data: { role: 'director' } });
    assert.equal((await db.video.findUnique({ where: { id: results[0].id } }))?.isTrial, true);
    await assert.rejects(videos.cancelDirectUploadTicket(ticket.ticketId, actor), /confirmed/i);
    assert.equal(deleted.length, 0);
    const maintenancePath = '../modules/quotas/upload-ticket-maintenance';
    const mod = await import(maintenancePath).catch(() => ({}));
    assert.equal(typeof mod.UploadTicketMaintenance, 'function', 'persistent staging cleanup required');
    const cleanup = new mod.UploadTicketMaintenance(db, quotas, storage);
    await cleanup.sweep(); assert.equal(deleted.filter((path) => path === ticket.objectPath).length, 0, 'signature still valid, reupload remains possible');
    await db.uploadTicket.update({ where: { id: ticket.ticketId }, data: { expiresAt: new Date(0) } });
    await cleanup.sweep();
    assert.ok(deleted.includes(ticket.objectPath), 'staging reupload is removed after signature expiry');
    assert.equal(deleted.some((path) => path.includes(`/sealed/${actor.id}/`)), false);
    await cleanup.sweep(); assert.equal(deleted.filter((path) => path === ticket.objectPath).length, 1, 'successful cleanup is idempotent');
  } finally { await db.$disconnect(); }
});

test('revision inherits the parent trial classification after the creator role changes', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url }), quotas = new QuotasService(db as any);
  const logs = new OperationLogsService(db as any), permissions = new PermissionsService(db as any, logs);
  const creator = await db.user.create({ data: { account: randomUUID(), name: 'Promoted visitor', role: 'director', passwordHash: 'unused' } });
  await db.$transaction(async (tx) => {
    await quotas.adjust(tx, creator.id, { kind: 'upload_count', period: 'lifetime', limit: 1, reason: 'test', businessKey: randomUUID() }, creator.id);
    await quotas.adjust(tx, creator.id, { kind: 'storage_bytes', period: 'lifetime', limit: 10, reason: 'test', businessKey: randomUUID() }, creator.id);
  });
  const parent = await db.video.create({ data: {
    creatorId: creator.id, isTrial: true, title: 'Trial parent', originalFileName: 'parent.mp4',
    filePath: 'unused', mimeType: 'video/mp4', fileSizeBytes: 1, videoType: 'other', status: 'revision_required',
  } });
  await db.supervisorReview.create({ data: { videoId: parent.id, reviewerId: creator.id, decision: 'revision_required' } });
  const directory = await mkdtemp(join(tmpdir(), 'identity-revision-'));
  const path = join(directory, 'revision.mp4'); await writeFile(path, '1234567890');
  const storage = { storeUploadedFile: async (file: any) => file.path, deleteStoredFile: (stored: string) => unlink(stored) };
  const videos = new VideosService(db as any, permissions, logs, storage as any, quotas);
  try {
    const revision = await videos.createRevision(parent.id, {}, {
      path, originalname: 'revision.mp4', mimetype: 'video/mp4', size: 10,
    } as Express.Multer.File, { id: creator.id, account: creator.account, name: creator.name, role: creator.role, managerId: null }, {
      uploadKey: randomUUID(),
    });
    assert.equal(revision.isTrial, true);
  } finally { await db.$disconnect(); await rm(directory, { recursive: true, force: true }); }
});
