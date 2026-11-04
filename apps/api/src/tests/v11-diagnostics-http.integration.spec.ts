import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { V11ContentLatestResponse } from '@ai-video-qc/shared';
import { contentDecisionNotice } from '../../../web/src/lib/v11-content-display';
import { configureLocalAcceptance } from '../test-support/local-acceptance';
import { JwtStrategy } from '../modules/auth/jwt.strategy';
import { PrismaService } from '../modules/prisma/prisma.service';
import { OperationLogsService } from '../modules/operation-logs/operation-logs.service';
import { PermissionsService } from '../modules/permissions/permissions.service';
import { V11ContentController } from '../modules/v11/v11-content.controller';
import { V11ContentService } from '../modules/v11/v11-content.service';
import { V11_CONTENT_DIMENSIONS } from '../modules/v11/content-scoring';
import { V11_FACT_CLAIMS } from '../modules/v11/fact-claims';

const url = process.env.V11_DIAGNOSTICS_TEST_DATABASE_URL;
// Load the actual Web renderer at test runtime without enabling JSX in the API compiler.
const { V11ContentDiagnostics } = require('../../../web/src/components/v11-content-diagnostics') as {
  V11ContentDiagnostics: ComponentType<{ diagnostics: NonNullable<V11ContentLatestResponse['diagnostics']> }>;
};
test('real PostgreSQL -> Nest latest HTTP -> actual Web diagnostic renderer', { skip: !url, timeout: 60_000 }, async t => {
  configureLocalAcceptance(url);
  const db = new PrismaClient({ datasources: { db: { url } } });
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
  try {
    assert.equal(await db.user.count(), 0, 'requires an empty isolated fixture database');
    const owner = await db.user.create({ data: { account: `fixture-${randomUUID()}`, name: 'Fixture', passwordHash: 'not-a-login-hash', role: 'director', mustChangePassword: false } });
    const other = await db.user.create({ data: { account: `other-${randomUUID()}`, name: 'Other', passwordHash: 'not-a-login-hash', role: 'director', mustChangePassword: false } });
    const admin = await db.user.create({ data: { account: `admin-${randomUUID()}`, name: 'Admin', passwordHash: 'not-a-login-hash', role: 'admin', mustChangePassword: false } });
    const video = await db.video.create({ data: { title: 'Diagnostic fixture', originalFileName: 'synthetic.mp4', filePath: '/tmp/nonexistent-diagnostics-fixture.mp4', fileSizeBytes: 1, mimeType: 'video/mp4', videoType: 'organic', creatorId: owner.id } });
    const versions = { promptVersion: 'fixture', schemaVersion: 'fixture', rubricVersion: 'fixture', ratingVersion: 'fixture', preprocessingVersion: 'fixture', referenceSetVersion: 'fixture' };
    const input = await db.v11EvaluationInputRevision.create({ data: { videoId: video.id, ownerId: owner.id, revision: 1, fileHash: 'a'.repeat(64), metadataSnapshot: {}, metadataSnapshotHash: 'b'.repeat(64), mediaManifest: {}, mediaManifestHash: 'c'.repeat(64), modelConfigSnapshot: {}, evaluationFingerprint: 'd'.repeat(64), ...versions } });
    const workflow = await db.v11WorkflowRevision.create({ data: { videoId: video.id, ownerId: owner.id, revision: 1 } });
    const group = await db.v11EvaluationGroup.create({ data: { videoId: video.id, ownerId: owner.id, inputRevisionId: input.id, workflowRevisionId: workflow.id, triggerReason: 'fixture', shadowMode: false, status: 'adopted' } });
    const dimensions = V11_CONTENT_DIMENSIONS.map(({ code }) => ({ dimension: code, observationStatus: 'observed', anchor: 3,
      facts: [`${code} fact`], factClaims: [{ key: V11_FACT_CLAIMS[code][0], state: 'present', evidenceReferences: ['fixture'] }],
      observation: `${code} representative observation`, evidence: [{ startSeconds: 0, endSeconds: 1, reference: 'fixture', description: `${code} evidence` }], improvementSuggestions: [`${code} suggestion`] }));
    const run = await db.v11EvaluationRun.create({ data: { groupId: group.id, runNumber: 1, runRole: 'primary', status: 'succeeded', blindContextHash: 'e'.repeat(64), modelProvider: 'fixture', modelName: 'never-called', modelConfigSnapshot: {}, structuredOutput: { dimensions, compliance: { status: 'clear', facts: [] } }, totalScore: 75, contentRating: 'B', ...versions } });
    const decision = await db.v11EvaluationDecision.create({ data: { groupId: group.id, workflowRevisionId: workflow.id, sourceRunIds: [run.id], adoptedDimensions: dimensions.map(d => ({ dimension: d.dimension, anchor: d.anchor })), totalScore: 75, contentRating: 'B', complianceStatus: 'clear', inputComplete: true, stable: true, adoptionMethod: 'single' } });
    await db.v11WorkflowRevision.update({ where: { id: workflow.id }, data: { activeContentDecisionId: decision.id } });
    const logs = new OperationLogsService(db as any);
    const permissions = new PermissionsService(db as any, logs);
    const forbiddenProvider = { analyzeVideo: async () => { throw Error('Provider calls forbidden'); } };
    const service = new V11ContentService(db as any, permissions, logs, {} as any, {} as any, forbiddenProvider as any);
    @Module({ controllers: [V11ContentController], providers: [
      { provide: V11ContentService, useValue: service }, { provide: PrismaService, useValue: db },
      { provide: OperationLogsService, useValue: logs }, { provide: JwtStrategy, useValue: new JwtStrategy(db as any) },
    ] })
    class FixtureModule {}
    app = await NestFactory.create(FixtureModule, { logger: ['error'], abortOnError: false });
    (app.get(V11ContentController) as unknown as { service: V11ContentService }).service = service;
    app.setGlobalPrefix('api'); await app.listen(0, '127.0.0.1');
    const token = async (userId: string) => {
      const session = await db.userSession.create({ data: { userId, expiresAt: new Date(Date.now() + 60_000) } });
      return new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: userId, sid: session.id }, { expiresIn: 60 });
    };
    const ownerToken = await token(owner.id), adminToken = await token(admin.id), otherToken = await token(other.id);
    const base = await app.getUrl();
    const latest = async (cookie = ownerToken) => {
      const response = await fetch(`${base}/api/videos/${video.id}/v11-content-review/latest`, { headers: { Cookie: `qc_session=${cookie}` } });
      return { status: response.status, body: await response.json() as V11ContentLatestResponse };
    };
    await t.test('nested wire contract, Decimal serialization, eight weights and real Web render', async () => {
      const { status, body } = await latest();
      assert.equal(status, 200); assert.deepEqual(Object.keys(body).sort(), ['diagnostics', 'group', 'shadowMode']);
      assert.equal(body.group!.decision!.id, decision.id); assert.equal(Number(body.group!.decision!.totalScore), 75);
      assert.deepEqual(body.diagnostics!.dimensions.map(d => d.dimension), V11_CONTENT_DIMENSIONS.map(d => d.code));
      assert.deepEqual(body.diagnostics!.dimensions.map(d => d.weight), [20, 20, 15, 15, 10, 10, 5, 5]);
      assert.ok(body.diagnostics!.dimensions.every(d => d.representativeRunId === run.id));
      assert.equal(body.group!.runs[0].structuredOutput, undefined);
      const html = renderToStaticMarkup(createElement(V11ContentDiagnostics, { diagnostics: body.diagnostics! }));
      assert.equal((html.match(/diagnostic-card/g) || []).length, 8);
      assert.match(html, /opening_hook representative observation/); assert.match(html, /0.0s/);
      assert.match(html, /建议处理顺序/); assert.match(html, /诊断说明来自采纳结果对应的代表评估/);
    });
    await t.test('owner boundary, authentication and admin-only technical output', async () => {
      assert.equal((await latest(otherToken)).status, 404);
      assert.equal((await latest('invalid')).status, 401);
      assert.ok((await latest(adminToken)).body.group!.runs[0].structuredOutput);
    });
    await t.test('newer non-source and pilot groups cannot replace the active decision', async () => {
      const pilot = await db.v11EvaluationGroup.create({ data: { videoId: video.id, ownerId: owner.id, inputRevisionId: input.id, workflowRevisionId: workflow.id, triggerReason: 'pilot', pilotRun: true, independent: true, shadowMode: true } });
      assert.notEqual((await latest()).body.group!.decision!.id, pilot.id);
      assert.equal((await latest()).body.diagnostics!.dimensions[0].representativeRunId, run.id);
    });
    await t.test('historical missing suggestions and missing structured output degrade safely', async () => {
      const legacy = dimensions.map(({ improvementSuggestions: _, ...dimension }) => dimension);
      await db.v11EvaluationRun.update({ where: { id: run.id }, data: { structuredOutput: { dimensions: legacy } } });
      assert.equal((await latest()).body.diagnostics!.dimensions[0].improvementSuggestions, null);
      await db.v11EvaluationRun.update({ where: { id: run.id }, data: { structuredOutput: {} } });
      const body = (await latest()).body;
      assert.equal(body.diagnostics!.dimensions[0].observation, null);
      assert.equal(Number(body.group!.decision!.totalScore), 75);
    });
    await t.test('current revision without pointer cannot expose prior revision score', async () => {
      await db.v11WorkflowRevision.update({ where: { id: workflow.id }, data: { status: 'superseded' } });
      await db.v11WorkflowRevision.create({ data: { videoId: video.id, ownerId: owner.id, revision: 2 } });
      const body = (await latest()).body;
      assert.equal(body.group, null); assert.equal(body.diagnostics, null);
      assert.match(contentDecisionNotice(body, 0, 0), /尚无有效/);
    });
  } finally { await app?.close(); await db.$disconnect(); }
});
