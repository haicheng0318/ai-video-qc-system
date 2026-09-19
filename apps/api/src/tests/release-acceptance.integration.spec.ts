import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { configureLocalAcceptance } from '../test-support/local-acceptance';

const url = process.env.RELEASE_TEST_DATABASE_URL;
test('V1.01 real local HTTP, database and worker acceptance (synthetic providers only)', { skip: !url }, async t => {
  configureLocalAcceptance(url);
  const directory = await mkdtemp(join(tmpdir(), 'ai-qc-task5-http-'));
  process.env.VIDEO_STORAGE_DIR = directory;
  const load = (module: string) => import(`../../dist/${module}`);
  const { AppModule } = await load('app.module');
  const { EvaluationJobsService } = await load('modules/evaluation-jobs/evaluation-jobs.service');
  const { EvaluationWorker } = await load('modules/evaluation-jobs/evaluation-worker');
  const { ContentReviewService } = await load('modules/ai/gemini/gemini.service');
  const { ResultReviewsService } = await load('modules/result-reviews/result-reviews.service');
  const { FinalEvaluationsService } = await load('modules/final-evaluations/final-evaluations.service');
  const { QWEN_CLIENT } = await load('modules/ai/gemini/qwen.client');
  const { TEXT_MODEL_CLIENT } = await load('modules/ai/gpt/gpt.client');
  const { VideoStorageService } = await load('modules/storage/video-storage.service');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const db = new PrismaClient({ datasourceUrl: url });
  const users: Record<string, any> = {};
  const password = 'task5-synthetic-password';
  const hash = await bcrypt.hash(password, 4);
  let contentGrade = 'A', resultGrade = 'A', insufficient = false, contentFailure = false, resultFailure = false, finalFailure = false;
  const calls = { content: 0, result: 0, final: 0 };
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    assert.equal(target.hostname, '127.0.0.1', 'acceptance must never reach an external HTTP target');
    return fetchOriginal(input, { ...init, redirect: init?.redirect || 'error' });
  };
  // Replace only provider transport boundaries. Schema validation, persistence, queues and permission guards remain real.
  app.get(QWEN_CLIENT).analyzeVideo = async (path: string) => {
    calls.content++; assert.ok((await readFile(path)).length > 0);
    if (contentFailure) return { rawResponse: '{invalid-json-fixture', usage: { inputTokens: 9, outputTokens: 2 } };
    return { rawResponse: JSON.stringify({ contentSummary: '本地固定视频内容证据', totalScore: contentGrade === 'A' ? 85 : 65,
      contentGrade, isPublishableRecommendation: true, mainProblems: [], revisionSuggestions: [], complianceRisks: [],
      usableScenarios: ['本地验收'], scores: [{ dimension: '信息表达', score: 8, maxScore: 10, comment: '清晰' }] }),
      usage: { inputTokens: 10, outputTokens: 5 } };
  };
  const textResponse = (body: unknown) => ({ responseId: randomUUID(), responseStatus: 'completed', rawText: JSON.stringify(body),
    model: 'local-fixture', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, usageAvailable: true });
  app.get(TEXT_MODEL_CLIENT).createResultReview = async (input: any) => {
    calls.result++;
    assert.equal(JSON.stringify(input.inputContext).includes(directory), false, 'text model context must not include a local video path');
    if (resultFailure) return { ...textResponse({}), rawText: '{invalid-result-json-fixture' };
    return textResponse({ dataScore: insufficient ? null : resultGrade === 'A' ? 85 : 65, dataGrade: insufficient ? null : resultGrade,
      dataSufficiency: insufficient ? 'insufficient' : 'sufficient', isBusinessEffectiveRecommendation: insufficient ? null : resultGrade === 'A',
      resultSummary: '本地固定数据复盘', performanceProblems: [], attributionAnalysis: [], optimizationSuggestions: [],
      sufficiencyReasons: insufficient ? [{ code: 'sample_too_small', description: '样本不足', requiredNextData: ['补充观察期'] }] : [],
      continueTestRecommendation: insufficient ? 'collect_more_data' : 'continue' });
  };
  app.get(TEXT_MODEL_CLIENT).createFinalEvaluation = async () => {
    calls.final++;
    if (finalFailure) return { ...textResponse({}), rawText: '{invalid-final-json-fixture' };
    const grade = contentGrade === 'C' && resultGrade === 'C' ? 'invalid' : resultGrade === 'C' ? 'low_effective' : 'effective';
    return textResponse({ recommendedFinalGrade: grade, recommendedFinalStatus: `final_${grade}`,
      recommendedIsEffective: grade !== 'invalid', recommendationConfidence: 85,
      decisionSummary: contentGrade === 'C' && resultGrade === 'A' ? '内容与数据存在不一致，需要人工复核' : '固定证据支持待确认建议',
      evidenceAssessment: ['content_review', 'result_review', 'rule_engine'].map(source => ({ source, strength: 'high', evidence: ['本地证据'], conclusion: '依据完整' })),
      finalAttribution: [{ type: 'mixed', confidence: 80, evidence: ['本地综合证据'], conclusion: '需结合业务判断' }],
      finalSuggestion: '等待负责人确认', confirmationFocus: ['核对业务背景'],
      riskFlags: contentGrade === 'C' && resultGrade === 'A' ? [{ code: 'content_data_conflict', description: '内容与数据不一致' }] : [] });
  };
  const jobs: any = app.get(EvaluationJobsService);
  const worker = () => new EvaluationWorker(jobs, app.get(ContentReviewService), app.get(ResultReviewsService), app.get(FinalEvaluationsService));
  const req = (path: string, role = 'admin', method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api${path}`, {
    method, headers: { Origin: 'http://localhost:3000', 'X-QC-CSRF': '1', 'Content-Type': 'application/json', Cookie: users[role]?.cookie || '', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = async (response: Response, expected = 200) => {
    const body: any = await response.json(); assert.equal(response.status, expected, JSON.stringify(body)); return body;
  };
  const upload = async (title: string, role = 'director', parent?: string, videoType = 'organic') => {
    const data = new FormData();
    data.append('title', title); if (!parent) { data.append('videoType', videoType); data.append('platform', 'fixture'); }
    data.append('file', new Blob([Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex')], { type: 'video/mp4' }), 'local-fixture.mp4');
    return json(await fetch(`${base}/api/videos${parent ? `/${parent}/revisions` : ''}`, { method: 'POST',
      headers: { Cookie: users[role].cookie, Origin: 'http://localhost:3000', 'X-QC-CSRF': '1', 'Idempotency-Key': randomUUID() }, body: data }), 201);
  };
  const videoState = async (id: string) => (await db.video.findUniqueOrThrow({ where: { id } })).status;
  const content = async (id: string, role = 'director') => {
    const before = calls.content;
    const queued = await json(await req(`/videos/${id}/content-review`, role, 'POST'), 202);
    assert.equal(calls.content, before, 'HTTP trigger must return before provider execution');
    assert.equal((await req(`/videos/${id}/content-review`, role, 'POST')).status, 409);
    assert.equal(await worker().runOnce(), true);
    assert.equal(calls.content, before + 1);
    const status = await json(await req(`/evaluation-jobs/${queued.jobId}`, role));
    assert.equal(status.status, contentFailure ? 'failed' : 'succeeded');
    return queued.reviewId;
  };
  const approve = async (id: string, decision = 'approved_for_publish') => json(await req(`/videos/${id}/supervisor-review`, 'supervisor', 'POST', {
    decision, comment: '本地主管验收', ...(decision === 'revision_required' ? { revisionRequirements: ['调整开场'] } : {}),
  }), 201);
  const metrics = async (id: string, role = 'operator', baseMetricId: string | null = null) => json(await req(`/videos/${id}/result-metrics`, role, 'POST', {
    baseMetricId, dataStartDate: '2026-09-01', dataEndDate: '2026-09-02', views: insufficient ? 2 : 1000,
    ...(role === 'advertiser' ? { impressions: 1000, spend: '100.00' } : {}),
  }), 201);
  const review = async (id: string, metricId: string, role = 'operator') => {
    const queued = await json(await req(`/videos/${id}/result-review`, role, 'POST', { resultMetricId: metricId }), 202);
    await worker().runOnce();
    return queued.reviewId;
  };
  const rule = async (id: string, reviewId: string) => (await json(await req(`/videos/${id}/rule-engine`, 'content_owner', 'POST', { resultReviewId: reviewId }), 201)).ruleEngineResult;
  const final = async (id: string, ruleId: string) => {
    const queued = await json(await req(`/videos/${id}/final-evaluation`, 'content_owner', 'POST', { ruleEngineResultId: ruleId }), 202);
    await worker().runOnce(); return queued.evaluationId;
  };
  const confirm = (id: string, evaluationId: string, grade = 'effective', role = 'content_owner', extra = {}) => req(`/videos/${id}/final-confirmation`, role, 'POST', {
    evaluationId, finalGrade: grade, canBeUsedForPerformance: false, ...extra,
  });
  const readyFinal = async (title: string) => {
    const v = await upload(title); const c = await content(v.id); await approve(v.id);
    const m = await metrics(v.id); const r = await review(v.id, m.id); const boundary = await rule(v.id, r);
    const f = await final(v.id, boundary.id); return { v, c, m, r, boundary, f };
  };
  let objectServer: ReturnType<typeof createServer> | undefined;
  try {
    for (const role of Object.values(UserRole)) {
      users[role] = await db.user.create({ data: { account: randomUUID(), name: `Task5 ${role}`, role, passwordHash: hash,
        ...(role === 'visitor' ? { expiresAt: new Date(Date.now() + 3600000) } : {}) } });
      const login = await req('/auth/login', '', 'POST', { account: users[role].account, password });
      await json(login.clone(), 201); users[role].cookie = login.headers.get('set-cookie')!.split(';')[0];
    }
    await db.user.update({ where: { id: users.director.id }, data: { managerId: users.supervisor.id } });
    for (const [kind, limit] of [['upload_count', 5], ['storage_bytes', 1000000], ['content_evaluations', 5]] as const) {
      await db.quotaPolicy.create({ data: { userId: users.visitor.id, kind, period: 'lifetime', limit } });
    }

    await t.test('upload → three evaluations → human confirmation → dashboard/cases; all grades and audits persist', async () => {
      const f = await readyFinal('完整正式闭环');
      assert.equal(await videoState(f.v.id), 'pending_final_confirmation');
      const pending = await db.finalVideoEvaluation.findUniqueOrThrow({ where: { id: f.f } });
      assert.equal(pending.finalGrade, null); assert.equal(pending.confirmedAt, null);
      const attempts = await Promise.all([confirm(f.v.id, f.f), confirm(f.v.id, f.f)]);
      assert.deepEqual(attempts.map(r => r.status).sort(), [200, 409]);
      const saved = await db.finalVideoEvaluation.findUniqueOrThrow({ where: { id: f.f } });
      assert.equal(saved.contentGrade, 'A'); assert.equal(saved.dataGrade, 'A'); assert.equal(saved.finalGrade, 'effective');
      assert.equal(saved.confirmedBy, users.content_owner.id); assert.ok(saved.confirmedAt);
      assert.equal(await videoState(f.v.id), 'final_effective');
      await json(await req(`/videos/${f.v.id}/case-marking`, 'content_owner', 'PUT', { evaluationId: f.f, caseType: 'excellent', reason: '可复用本地验收案例' }));
      const cases = await json(await req('/cases?type=excellent')); assert.ok(JSON.stringify(cases).includes(f.v.id));
      const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
      const summary = await json(await req(`/dashboard/summary?startDate=${day}&endDate=${day}`)); assert.ok(summary.finalizedCount >= 1);
      const logs = await db.operationLog.findMany({ where: { videoId: f.v.id } });
      for (const action of ['video_uploaded', 'ai_content_review_completed', 'supervisor_review_approved', 'result_metric_snapshot_created',
        'ai_result_review_completed', 'rule_engine_executed', 'final_evaluation_completed', 'final_evaluation_confirmed', 'excellent_case_marked']) {
        assert.ok(logs.some(log => log.actionType === action), `missing audit: ${action}`);
      }
      const detail = await json(await req(`/videos/${f.v.id}`, 'director'));
      assert.equal(JSON.stringify(detail).includes('rawResponse'), false);
      assert.equal(JSON.stringify(detail).includes(directory), false);
      const csv = await req(`/videos/${f.v.id}/report`, 'director'); assert.equal(csv.status, 200);
      assert.equal((await csv.text()).includes('passwordHash'), false);
    });

    await t.test('Range returns exact bytes, suffix/open ranges and 416; anonymous and other creator are denied', async () => {
      const v = await upload('Range本地文件');
      const all = await req(`/videos/${v.id}/file`, 'director'); assert.equal(all.status, 200);
      const bytes = Buffer.from(await all.arrayBuffer());
      for (const [range, start, end] of [['bytes=0-3', 0, 3], ['bytes=4-', 4, bytes.length - 1], ['bytes=-4', bytes.length - 4, bytes.length - 1]] as const) {
        const part = await req(`/videos/${v.id}/file`, 'director', 'GET', undefined, { Range: range });
        assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), `bytes ${start}-${end}/${bytes.length}`);
        assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(start, end + 1));
      }
      for (const range of ['bytes=9999-', 'bytes=9-2', 'bytes=0-1,4-5', 'bytes=-0']) assert.equal((await req(`/videos/${v.id}/file`, 'director', 'GET', undefined, { Range: range })).status, 416);
      assert.equal((await req(`/videos/${v.id}/file`, '')).status, 401);
      assert.equal((await req(`/videos/${v.id}/file`, 'visitor')).status, 403);
    });

    await t.test('aborted multipart upload removes partially written files without consuming a video or quota', async () => {
      const before = (await readdir(directory)).sort();
      const videosBefore = await db.video.count({ where: { creatorId: users.director.id } });
      const uploadKey = randomUUID();
      const request = httpRequest(`${base}/api/videos`, { method: 'POST', headers: {
        Cookie: users.director.cookie, Origin: 'http://localhost:3000', 'X-QC-CSRF': '1', 'Idempotency-Key': uploadKey,
        'Content-Type': 'multipart/form-data; boundary=task5-boundary', 'Content-Length': 100000,
      } });
      request.on('error', () => undefined);
      request.write('--task5-boundary\r\nContent-Disposition: form-data; name="file"; filename="aborted.mp4"\r\nContent-Type: video/mp4\r\n\r\n');
      request.write(Buffer.alloc(4096, 1));
      try {
        for (let attempt = 0; attempt < 50 && (await readdir(directory)).length === before.length; attempt++) await new Promise(r => setTimeout(r, 20));
        assert.ok((await readdir(directory)).length > before.length, 'fixture must reach the on-disk partial-write stage');
        request.destroy();
        for (let attempt = 0; attempt < 100 && (await readdir(directory)).length !== before.length; attempt++) await new Promise(r => setTimeout(r, 20));
        assert.deepEqual((await readdir(directory)).sort(), before, 'aborted multipart left an orphan file');
        assert.equal(await db.video.count({ where: { creatorId: users.director.id } }), videosBefore);
        assert.equal(await db.quotaLedger.count({ where: { businessKey: { contains: uploadKey } } }), 0);
      } finally { request.destroy(); }
    });

    await t.test('revision creates a linked version and invalid content cannot enter result data', async () => {
      const parent = await upload('返修原版'); const originalReview = await content(parent.id); await approve(parent.id, 'revision_required');
      const child = await upload('返修第二版', 'director', parent.id);
      assert.equal(child.parentVideoId, parent.id); assert.equal(child.version, 2); assert.equal(await videoState(parent.id), 'revision_required');
      assert.equal((await db.aiContentReview.findUniqueOrThrow({ where: { id: originalReview } })).status, 'succeeded');
      await content(child.id); await approve(child.id, 'invalid_content');
      assert.equal((await req(`/videos/${child.id}/result-metrics`, 'operator', 'POST', { baseMetricId: null })).status, 409);
      assert.equal(await db.videoResultMetric.count({ where: { videoId: child.id } }), 0);
    });

    await t.test('insufficient data stays ungraded and returns through a new snapshot without losing old evidence', async () => {
      insufficient = true;
      const v = await upload('样本不足'); await content(v.id); await approve(v.id);
      const m = await metrics(v.id); const r = await review(v.id, m.id); const boundary = await rule(v.id, r);
      assert.equal(boundary.ruleResult, 'pending_data'); assert.equal(boundary.dataGrade, null); assert.equal(await videoState(v.id), 'pending_data');
      assert.equal((await req(`/videos/${v.id}/final-evaluation`, 'content_owner', 'POST', { ruleEngineResultId: boundary.id })).status, 409);
      assert.equal(await db.finalVideoEvaluation.count({ where: { videoId: v.id } }), 0);
      insufficient = false;
      const newer = await metrics(v.id, 'operator', m.id); const rr = await review(v.id, newer.id); const rb = await rule(v.id, rr);
      assert.equal(rb.dataGrade, 'A'); assert.notEqual(rb.id, boundary.id);
      assert.equal((await db.aiResultReview.findUniqueOrThrow({ where: { id: r } })).dataGrade, null);
    });

    await t.test('all seven roles enforce the business matrix and visitors cannot access later workflow or another video', async () => {
      const v = await upload('权限矩阵');
      for (const role of ['supervisor', 'operator', 'advertiser', 'visitor']) assert.equal((await req(`/videos/${v.id}/content-review`, role, 'POST')).status, 403, role);
      await content(v.id);
      for (const role of ['director', 'operator', 'advertiser', 'visitor']) assert.equal((await req(`/videos/${v.id}/supervisor-review`, role, 'POST', { decision: 'approved_for_publish' })).status, 403, role);
      await approve(v.id);
      for (const role of ['director', 'supervisor', 'advertiser', 'visitor']) assert.equal((await req(`/videos/${v.id}/result-metrics`, role, 'POST', { baseMetricId: null })).status, 403, role);
      const m = await metrics(v.id); const r = await review(v.id, m.id);
      for (const role of ['director', 'supervisor', 'operator', 'advertiser', 'visitor']) assert.equal((await req(`/videos/${v.id}/rule-engine`, role, 'POST', { resultReviewId: r })).status, 403, role);
      const b = await rule(v.id, r); const f = await final(v.id, b.id);
      for (const role of ['director', 'supervisor', 'operator', 'advertiser', 'visitor']) assert.equal((await confirm(v.id, f, 'effective', role)).status, 403, role);
      for (const role of ['content_owner', 'director', 'supervisor', 'operator', 'advertiser', 'visitor']) assert.equal((await req('/admin/operations/overview', role)).status, 403, role);
      const own = await upload('访客自己的试用视频', 'visitor'); assert.equal(own.isTrial, true); await content(own.id, 'visitor');
      for (const suffix of ['/result-metrics/latest', '/result-review/latest', '/final-evaluation/latest']) assert.equal((await req(`/videos/${own.id}${suffix}`, 'visitor')).status, 403);
      for (const suffix of ['', '/file-url', '/report']) assert.equal((await req(`/videos/${v.id}${suffix}`, 'visitor')).status, 403);
      const ad = await upload('投放类型', 'director', undefined, 'qianchuan_ad'); await content(ad.id); await approve(ad.id);
      assert.equal((await req(`/videos/${ad.id}/result-metrics`, 'operator', 'POST', { baseMetricId: null })).status, 403);
      await metrics(ad.id, 'advertiser');
    });

    await t.test('new metric evidence makes a prior recommendation unconfirmable', async () => {
      const f = await readyFinal('陈旧指标拒绝');
      await db.videoResultMetric.create({ data: { videoId: f.v.id, videoType: 'organic', views: 2000, submittedBy: users.operator.id } });
      assert.equal((await confirm(f.v.id, f.f)).status, 409);
      assert.equal((await db.finalVideoEvaluation.findUniqueOrThrow({ where: { id: f.f } })).confirmedAt, null);
    });

    await t.test('poor results, negative cases and content/data conflict follow the hard boundary with an audited human adjustment', async () => {
      for (const [c, r, expected] of [['A', 'C', 'low_effective'], ['C', 'C', 'invalid'], ['C', 'A', 'low_effective']]) {
        contentGrade = c; resultGrade = r;
        const f = await readyFinal(`边界-${c}-${r}`);
        const manual = c === 'C' && r === 'A';
        if (manual) assert.equal((await confirm(f.v.id, f.f, 'effective')).status, 400, 'conflicting evidence needs a human explanation');
        const extra = manual ? { confirmationComment: '负责人已逐项核对本地模拟业务证据', manualAdjustReason: '结合模拟线下证据保守调整为低有效' } : {};
        await json(await confirm(f.v.id, f.f, expected, 'content_owner', extra));
        assert.equal(await videoState(f.v.id), `final_${expected}`);
        if (expected === 'invalid') await json(await req(`/videos/${f.v.id}/case-marking`, 'content_owner', 'PUT', { evaluationId: f.f, caseType: 'negative', reason: '本地反面案例证据完整' }));
        if (manual) assert.equal(await db.operationLog.count({ where: { videoId: f.v.id, actionType: 'final_grade_adjusted' } }), 1);
      }
      contentGrade = 'A'; resultGrade = 'A';
    });

    await t.test('changed supervisor evidence makes a prior recommendation unconfirmable', async () => {
      const f = await readyFinal('陈旧主管意见拒绝');
      await db.supervisorReview.update({ where: { videoId: f.v.id }, data: { comment: '源意见已变化', reviewedAt: new Date(Date.now() + 1000) } });
      assert.equal((await confirm(f.v.id, f.f)).status, 409);
      assert.equal((await db.finalVideoEvaluation.findUniqueOrThrow({ where: { id: f.f } })).confirmedAt, null);
    });

    await t.test('invalid model JSON fails all three stages and explicit retries retain the original response', async () => {
      contentFailure = true;
      const v = await upload('三阶段失败'); const failedContent = await content(v.id); assert.equal(await videoState(v.id), 'ai_content_failed');
      contentFailure = false; await content(v.id); await approve(v.id);
      const m = await metrics(v.id); resultFailure = true; const failedResult = await review(v.id, m.id); assert.equal(await videoState(v.id), 'ai_result_failed');
      resultFailure = false; const r = await review(v.id, m.id); const b = await rule(v.id, r);
      finalFailure = true; const failedFinal = await final(v.id, b.id); assert.equal(await videoState(v.id), 'final_evaluation_failed');
      finalFailure = false; const f = await final(v.id, b.id); assert.equal(await videoState(v.id), 'pending_final_confirmation');
      assert.notEqual(f, failedFinal);
      assert.ok(JSON.stringify((await db.aiContentReview.findUniqueOrThrow({ where: { id: failedContent } })).rawResponse).includes('invalid-json-fixture'));
      assert.ok(JSON.stringify((await db.aiResultReview.findUniqueOrThrow({ where: { id: failedResult } })).rawResponse).includes('invalid-result-json-fixture'));
      assert.ok(JSON.stringify((await db.finalVideoEvaluation.findUniqueOrThrow({ where: { id: failedFinal } })).rawResponse).includes('invalid-final-json-fixture'));
    });

    await t.test('SIGKILL before/after external boundary recovers in a new worker process without replaying an uncertain call', async () => {
      for (const mode of ['before_external', 'after_external']) {
        const v = await db.video.create({ data: { creatorId: users.admin.id, title: 'process-kill-fixture', originalFileName: 'unused.mp4',
          filePath: 'unused-fixture-only', mimeType: 'video/mp4', fileSizeBytes: 1, videoType: 'other', status: 'ai_content_reviewing' } });
        const r = await db.aiContentReview.create({ data: { videoId: v.id, status: 'running', modelProvider: 'fixture', modelName: 'local' } });
        const job: any = await db.$transaction(tx => jobs.enqueue(tx, { videoId: v.id, actorId: users.admin.id, stage: 'content', contentReviewId: r.id }));
        const launch = (step: string) => spawn(process.execPath, ['--import', 'tsx', 'src/test-support/release-worker-child.ts', step], {
          cwd: process.cwd(), env: { PATH: process.env.PATH, QC_LOCAL_ACCEPTANCE: '1', QC_SKIP_DOTENV: '1', RELEASE_TEST_DATABASE_URL: url }, stdio: ['ignore', 'pipe', 'pipe'],
        });
        const child = launch(mode);
        try {
          const ready = await new Promise<any>((resolve, reject) => {
            const timeout = setTimeout(() => reject(Error('Fault fixture did not claim within 10 seconds')), 10000);
            let output = '';
            child.stdout.on('data', data => { output += data; if (output.includes('\n')) { clearTimeout(timeout); resolve(JSON.parse(output.trim())); } });
            child.once('exit', code => { clearTimeout(timeout); reject(Error(`Fixture exited before claim: ${code}`)); });
          });
          assert.equal(ready.jobId, job.id);
          const stopped = once(child, 'exit'); child.kill('SIGKILL'); await stopped;
          await db.evaluationJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(0) } });
          const recovery = launch('recover'); const [code] = await once(recovery, 'exit'); assert.equal(code, 0);
          const recovered = await db.evaluationJob.findUniqueOrThrow({ where: { id: job.id } });
          assert.equal(recovered.status, mode === 'before_external' ? 'retry_wait' : 'needs_attention');
          assert.equal(recovered.attempts, 1);
          if (mode === 'before_external') {
            // Close just this synthetic task so the next case cannot claim it.
            await db.evaluationJob.update({ where: { id: job.id }, data: { status: 'failed' } });
            await db.aiContentReview.update({ where: { id: r.id }, data: { status: 'failed' } });
            await db.video.update({ where: { id: v.id }, data: { status: 'ai_content_failed' } });
          }
        } finally { child.kill('SIGTERM'); }
      }
    });

    await t.test('local object HTTP fixture proves redirect/renewal authorization and existing URL residual TTL, not COS semantics', async () => {
      const tokens = new Map<string, number>(); let fixtureClock = 0;
      objectServer = createServer((request, response) => {
        const token = new URL(request.url!, 'http://127.0.0.1').searchParams.get('token') || '';
        if ((tokens.get(token) || 0) <= fixtureClock) { response.writeHead(403); response.end('fixture expired'); return; }
        response.writeHead(200, { 'Content-Type': 'video/mp4' }); response.end('local-object-fixture');
      });
      objectServer.listen(0, '127.0.0.1'); await once(objectServer, 'listening');
      const port = (objectServer.address() as any).port;
      app.get(VideoStorageService).createReadUrl = async () => {
        const token = randomUUID(); tokens.set(token, fixtureClock + 10); return `http://127.0.0.1:${port}/object?token=${token}`;
      };
      const v = await db.video.create({ data: { creatorId: users.visitor.id, isTrial: true, title: 'local object fixture', originalFileName: 'fixture.mp4',
        filePath: 'cos://local-fixture-only/object', mimeType: 'video/mp4', fileSizeBytes: 20, videoType: 'other' } });
      const first = await json(await req(`/videos/${v.id}/file-url`, 'visitor'));
      assert.equal((await fetch(first.url)).status, 200);
      const redirect = await fetch(`${base}/api/videos/${v.id}/file`, { headers: { Cookie: users.visitor.cookie }, redirect: 'manual' });
      assert.equal(redirect.status, 302); assert.equal(new URL(redirect.headers.get('location')!).hostname, '127.0.0.1');
      fixtureClock = 11; assert.equal((await fetch(first.url)).status, 403);
      const renewed = await json(await req(`/videos/${v.id}/file-url`, 'visitor')); assert.notEqual(renewed.url, first.url);
      await db.user.update({ where: { id: users.visitor.id }, data: { expiresAt: new Date(0) } });
      assert.equal((await req(`/videos/${v.id}/file-url`, 'visitor')).status, 401);
      assert.equal((await fetch(renewed.url)).status, 200, 'already issued object URL has a documented residual lifetime');
      fixtureClock = 22; assert.equal((await fetch(renewed.url)).status, 403);
    });
  } finally {
    globalThis.fetch = fetchOriginal;
    if (objectServer) await new Promise<void>((resolve, reject) => objectServer!.close(error => error ? reject(error) : resolve()));
    await app.close(); await db.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
