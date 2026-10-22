import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Prisma, PrismaClient } from '@prisma/client';
import { configureLocalAcceptance } from '../test-support/local-acceptance';
import { JwtStrategy } from '../modules/auth/jwt.strategy';
import { PrismaService } from '../modules/prisma/prisma.service';
import { EvaluationJobsService } from '../modules/evaluation-jobs/evaluation-jobs.service';
import { EvaluationWorker } from '../modules/evaluation-jobs/evaluation-worker';
import { OperationLogsService } from '../modules/operation-logs/operation-logs.service';
import { PermissionsService } from '../modules/permissions/permissions.service';
import { V11ContentController } from '../modules/v11/v11-content.controller';
import { V11ContentService } from '../modules/v11/v11-content.service';
import { createMediaManifest } from '../modules/v11/media-manifest';
import { V11_CONTENT_DIMENSIONS } from '../modules/v11/content-scoring';
import { V11_FACT_CLAIMS } from '../modules/v11/fact-claims';

// Opt-in only. Run serially against a NEW disposable database, never a business database.
const url = process.env.V11_HOTFIX_TEST_DATABASE_URL;
const migrationName = '20261022090000_fix_v11_evaluation_job_constraints';

test('V11 hotfix: old-17 failure, nonempty upgrade, target matrix, rollback, HTTP and real worker dispatch', { skip: !url, timeout: 240_000 }, async (t) => {
  configureLocalAcceptance(url!);
  const db = new PrismaClient({ datasources: { db: { url } } });
  const temporary = await mkdtemp(join(tmpdir(), 'v11-job-hotfix-'));
  const schemaRoot = resolve(process.cwd(), '../../prisma');
  const prismaCli = require.resolve('prisma/build/index.js');
  const deploy = (schema: string, databaseUrl = url!) => execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schema], {
    env: { ...process.env, DATABASE_URL: databaseUrl, QC_SKIP_DOTENV: '1' }, encoding: 'utf8', timeout: 90_000,
  });
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
  try {
    const tables = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM information_schema.tables WHERE table_schema='public'`;
    assert.equal(Number(tables[0].count), 0, 'refuse nonempty database');
    await cp(join(schemaRoot, 'schema.prisma'), join(temporary, 'schema.prisma'));
    await cp(join(schemaRoot, 'migrations'), join(temporary, 'migrations'), {
      recursive: true, filter: source => !source.includes(migrationName),
    });
    deploy(join(temporary, 'schema.prisma'));
    const applied = () => db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    assert.equal(Number((await applied())[0].count), 17);
    const actor = await db.user.create({ data: { account: `hotfix-${randomUUID()}`, name: 'Fixture only', passwordHash: 'not-a-login-hash', role: 'admin', mustChangePassword: false } });
    const mediaPath = process.env.V11_HOTFIX_MEDIA_PATH;
    assert.ok(mediaPath, 'explicit synthetic media fixture required');
    const media = await createMediaManifest(mediaPath, { sizeBytes: BigInt((await stat(mediaPath)).size), durationSeconds: null });
    assert.equal(media.inputComplete, true);
    assert.equal(typeof media.manifest.hasAudio, 'boolean');
    assert.ok(media.manifest.durationSeconds && media.manifest.fps && media.manifest.width && media.manifest.height);
    const video = await db.video.create({ data: { title: 'Synthetic fixture', originalFileName: 'fixture.mp4', filePath: mediaPath, fileSizeBytes: BigInt((await stat(mediaPath)).size), mimeType: 'video/mp4', videoType: 'organic', creatorId: actor.id } });
    const logs = new OperationLogsService(db as any);
    const permissions = new PermissionsService(db as any, logs);
    const jobs = new EvaluationJobsService(db as any, permissions);
    const content = await db.aiContentReview.create({ data: { videoId: video.id, modelProvider: 'fixture', modelName: 'fake', status: 'pending' } });
    const result = await db.aiResultReview.create({ data: { videoId: video.id, modelProvider: 'fixture', modelName: 'fake', status: 'pending' } });
    const rule = await db.ruleEngineResult.create({ data: { videoId: video.id, contentReviewId: content.id, resultReviewId: result.id, ruleCode: 'fixture', ruleResult: 'fixture', ruleReason: 'fixture', recommendedBoundary: 'fixture' } });
    const final = await db.finalVideoEvaluation.create({ data: { videoId: video.id, contentReviewId: content.id, resultReviewId: result.id, ruleEngineResultId: rule.id, triggeredById: actor.id, modelProvider: 'fixture', modelName: 'fake', contentGrade: 'B', dataGrade: 'B' } });
    const common = { videoId: video.id, actorId: actor.id };
    for (const data of [{ stage: 'content', contentReviewId: content.id }, { stage: 'result', resultReviewId: result.id }, { stage: 'final', finalEvaluationId: final.id }]) {
      await db.evaluationJob.create({ data: { ...common, ...data, status: 'succeeded' } });
    }
    const before = await db.evaluationJob.findMany({ orderBy: { id: 'asc' } });
    const versions = { promptVersion: 'fixture', schemaVersion: 'fixture', rubricVersion: 'fixture', ratingVersion: 'fixture', preprocessingVersion: 'fixture', referenceSetVersion: 'fixture' };
    const createRun = async (tx: Prisma.TransactionClient) => {
      const input = await tx.v11EvaluationInputRevision.create({ data: { videoId: video.id, ownerId: actor.id, revision: 1, fileHash: 'a'.repeat(64), metadataSnapshot: {}, metadataSnapshotHash: 'b'.repeat(64), mediaManifest: {}, mediaManifestHash: 'c'.repeat(64), modelConfigSnapshot: {}, evaluationFingerprint: 'd'.repeat(64), ...versions } });
      const workflow = await tx.v11WorkflowRevision.create({ data: { videoId: video.id, ownerId: actor.id, revision: 1 } });
      const group = await tx.v11EvaluationGroup.create({ data: { videoId: video.id, ownerId: actor.id, inputRevisionId: input.id, workflowRevisionId: workflow.id, triggerReason: 'fixture' } });
      return tx.v11EvaluationRun.create({ data: { groupId: group.id, runNumber: 1, runRole: 'primary', blindContextHash: 'e'.repeat(64), modelProvider: 'fixture', modelName: 'fake', modelConfigSnapshot: {}, ...versions } });
    };
    const counts = async () => Promise.all([db.v11EvaluationInputRevision.count(), db.v11WorkflowRevision.count(), db.v11EvaluationGroup.count(), db.v11EvaluationRun.count(), db.evaluationJob.count()]);
    await t.test('old 17 rejects actual v11 enqueue and rolls back all five records', async () => {
      await assert.rejects(db.$transaction(async tx => {
        const run = await createRun(tx);
        await jobs.enqueue(tx, { ...common, stage: 'v11_content', v11RunId: run.id });
      }), /evaluation_jobs_stage_check|23514/);
      assert.deepEqual(await counts(), [0, 0, 0, 0, 3]);
    });
    deploy(join(schemaRoot, 'schema.prisma'));
    await t.test('18 migrations preserve every legacy job field and NOT NULL stage', async () => {
      assert.equal(Number((await applied())[0].count), 18);
      assert.deepEqual(await db.evaluationJob.findMany({ orderBy: { id: 'asc' } }), before);
      const stage = await db.$queryRaw<Array<{ is_nullable: string }>>`SELECT is_nullable FROM information_schema.columns WHERE table_name='evaluation_jobs' AND column_name='stage'`;
      assert.equal(stage[0].is_nullable, 'NO');
    });
    const rollback = new Error('fixture rollback');
    await t.test('actual v11 enqueue passes; explicit transaction failure leaves no partial records', async () => {
      await assert.rejects(db.$transaction(async tx => {
        const run = await createRun(tx);
        const job = await jobs.enqueue(tx, { ...common, stage: 'v11_content', v11RunId: run.id });
        assert.equal(job.stage, 'v11_content'); assert.equal(job.v11RunId, run.id);
        assert.deepEqual([job.contentReviewId, job.resultReviewId, job.finalEvaluationId], [null, null, null]);
        assert.ok(await tx.evaluationJob.findUnique({ where: { id: job.id } }));
        throw rollback;
      }), error => error === rollback);
      assert.deepEqual(await counts(), [0, 0, 0, 0, 3]);
    });
    const valid = [
      { stage: 'content', contentReviewId: content.id }, { stage: 'result', resultReviewId: result.id },
      { stage: 'final', finalEvaluationId: final.id }, { stage: 'v11_content', v11RunId: 'RUN' },
    ];
    const invalid = [
      { stage: 'v11_content' }, { stage: 'v11_content', contentReviewId: content.id },
      { stage: 'content', v11RunId: 'RUN' }, { stage: 'result', v11RunId: 'RUN' },
      { stage: 'final', v11RunId: 'RUN' }, { stage: 'invalid', contentReviewId: content.id },
      { stage: 'content', contentReviewId: content.id, resultReviewId: result.id },
      { stage: 'v11_content', v11RunId: 'RUN', contentReviewId: content.id },
      { stage: 'result', resultReviewId: result.id, v11RunId: 'RUN' },
      { stage: 'final', finalEvaluationId: final.id, v11RunId: 'RUN' },
    ];
    for (const [index, candidate] of [...valid, ...invalid].entries()) {
      await t.test(`target matrix ${index + 1}: ${JSON.stringify(candidate)}`, async () => {
        await assert.rejects(db.$transaction(async tx => {
          const run = await createRun(tx);
          const data: any = { ...common, ...candidate, status: 'succeeded' };
          if (data.v11RunId) data.v11RunId = run.id;
          // Each target has a UNIQUE binding; use fresh legacy targets so a unique
          // violation cannot mask the CHECK constraint under test.
          const c = await tx.aiContentReview.create({ data: { videoId: video.id, modelProvider: 'fixture', modelName: 'fake' } });
          const r = await tx.aiResultReview.create({ data: { videoId: video.id, modelProvider: 'fixture', modelName: 'fake' } });
          const ruleFixture = await tx.ruleEngineResult.create({ data: { videoId: video.id, contentReviewId: c.id, resultReviewId: r.id, ruleCode: 'fixture', ruleResult: 'fixture', ruleReason: 'fixture', recommendedBoundary: 'fixture' } });
          const f = await tx.finalVideoEvaluation.create({ data: { videoId: video.id, contentReviewId: c.id, resultReviewId: r.id, ruleEngineResultId: ruleFixture.id, triggeredById: actor.id, modelProvider: 'fixture', modelName: 'fake', contentGrade: 'B', dataGrade: 'B' } });
          if (data.contentReviewId) data.contentReviewId = c.id;
          if (data.resultReviewId) data.resultReviewId = r.id;
          if (data.finalEvaluationId) data.finalEvaluationId = f.id;
          const job = await tx.evaluationJob.create({ data });
          assert.ok(await tx.evaluationJob.findUnique({ where: { id: job.id } }));
          throw rollback;
        }), error => index < valid.length ? error === rollback : /evaluation_jobs_(target|stage)_check|23514/.test(String(error)));
        assert.deepEqual(await counts(), [0, 0, 0, 0, 3]);
      });
    }
    await db.runtimeSetting.create({ data: { key: 'v11_content_shadow', value: { enabled: true, shadowMode: true } } });
    let fakeCalls = 0;
    const fake = { analyzeVideo: async () => {
      fakeCalls += 1;
      return { rawResponse: JSON.stringify({ dimensions: V11_CONTENT_DIMENSIONS.map(({ code }) => ({
        dimension: code, observationStatus: 'observed', anchor: 3, facts: [`${code} observed`],
        factClaims: [{ key: V11_FACT_CLAIMS[code][0], state: 'present', evidenceReferences: ['00:00-00:01'] }],
        evidence: [{ startSeconds: 0, endSeconds: 1, reference: '00:00-00:01', description: `${code} evidence` }], observation: `${code} observation`,
      })), compliance: { status: 'clear', facts: [] } }) };
    } };
    const service = new V11ContentService(db as any, permissions, logs,
      { materialize: async () => ({ path: mediaPath, cleanup: async () => undefined }) } as any, jobs, fake as any);
    @Module({ controllers: [V11ContentController], providers: [
      { provide: V11ContentService, useValue: service },
      { provide: OperationLogsService, useValue: logs },
      { provide: PrismaService, useValue: db },
      JwtStrategy,
    ] })
    class FixtureModule {}
    app = await NestFactory.create(FixtureModule, { logger: ['error'], abortOnError: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    await t.test('real HTTP 202 creates complete input, workflow, group, run, job; worker executes fake provider', async () => {
      const session = await db.userSession.create({ data: { userId: actor.id, expiresAt: new Date(Date.now() + 60000) } });
      const token = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: actor.id, sid: session.id }, { expiresIn: 60 });
      const response = await fetch(`${await app!.getUrl()}/api/videos/${video.id}/v11-content-review`, { method: 'POST', headers: { Cookie: `qc_session=${token}` } });
      const body: any = await response.json();
      assert.equal(response.status, 202, JSON.stringify(body));
      const job = await db.evaluationJob.findUniqueOrThrow({ where: { id: body.jobId } });
      const run = await db.v11EvaluationRun.findUniqueOrThrow({ where: { id: body.runId }, include: { group: { include: { inputRevision: true, workflowRevision: true } } } });
      assert.equal(job.stage, 'v11_content'); assert.equal(job.v11RunId, run.id);
      assert.equal(run.group.inputRevision.inputComplete, true);
      assert.equal(run.group.workflowRevision.status, 'current');
      const unavailable = { executeJob: async () => { throw new Error('wrong worker stage'); } } as any;
      const worker = new EvaluationWorker(jobs, unavailable, unavailable, unavailable, service);
      assert.equal(await worker.runOnce(), true);
      assert.equal(fakeCalls, 1);
      const completed = await db.v11EvaluationRun.findUniqueOrThrow({ where: { id: run.id } });
      assert.equal(completed.status, 'succeeded', completed.errorMessage || '');
      assert.equal((await db.evaluationJob.findUniqueOrThrow({ where: { id: job.id } })).status, 'succeeded');
      assert.equal(await db.evaluationJobAttempt.count({ where: { jobId: job.id, status: 'succeeded' } }), 1);
      assert.equal((await db.video.findUniqueOrThrow({ where: { id: video.id } })).status, video.status, 'shadow preserves video state');
    });
    await t.test('fresh database deploys all 18 migrations', async () => {
      const freshUrl = process.env.V11_HOTFIX_FRESH_DATABASE_URL!;
      assert.ok(freshUrl, 'separate pre-created empty fixture database required');
      configureLocalAcceptance(freshUrl);
      const fresh = new PrismaClient({ datasources: { db: { url: freshUrl } } });
      try {
        const existing = await fresh.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM information_schema.tables WHERE table_schema='public'`;
        assert.equal(Number(existing[0].count), 0);
        deploy(join(schemaRoot, 'schema.prisma'), freshUrl);
        const rows = await fresh.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
        assert.equal(Number(rows[0].count), 18);
        const failed = await fresh.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
        assert.equal(Number(failed[0].count), 0);
      } finally { await fresh.$disconnect(); }
    });
    assert.equal((await readdir(join(schemaRoot, 'migrations'))).filter(name => /^\d/.test(name)).length, 18);
  } finally {
    await app?.close();
    await db.$disconnect();
    await rm(temporary, { recursive: true, force: true });
  }
});
