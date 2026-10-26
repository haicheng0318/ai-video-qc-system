import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { configureLocalAcceptance } from '../test-support/local-acceptance';
import { V11_CONTENT_DIMENSIONS } from '../modules/v11/content-scoring';
import { V11_FACT_CLAIMS } from '../modules/v11/fact-claims';

const url = process.env.RELEASE_TEST_DATABASE_URL;
const mediaPath = process.env.RELEASE_TEST_MEDIA_PATH;
const releaseAcceptanceRequired = process.env.RELEASE_ACCEPTANCE_REQUIRED === '1';
if (releaseAcceptanceRequired && (!url || !mediaPath)) {
  throw new Error('Required Release Acceptance needs RELEASE_TEST_DATABASE_URL and RELEASE_TEST_MEDIA_PATH; refusing to skip.');
}

type ClaimState = 'present' | 'absent' | 'uncertain';
type OutputOptions = {
  actionCue?: ClaimState;
  audioPresent?: ClaimState;
  anchor?: number;
  actionAnchor?: number;
  complianceStatus?: 'clear' | 'suspected' | 'confirmed';
};

function v11Output(options: OutputOptions = {}) {
  return {
    dimensions: V11_CONTENT_DIMENSIONS.map(({ code }) => {
      const key = V11_FACT_CLAIMS[code][0];
      const state = code === 'action_logic' && key === 'action_cue_present'
        ? options.actionCue ?? 'absent'
        : code === 'subtitle_audio' && key === 'audio_present'
          ? options.audioPresent ?? 'present'
          : 'present';
      return {
        dimension: code,
        observationStatus: 'observed' as const,
        anchor: code === 'action_logic' ? options.actionAnchor ?? options.anchor ?? 4 : options.anchor ?? 4,
        facts: [`${code} synthetic release evidence`],
        factClaims: [{ key, state, evidenceReferences: ['00:00-00:01'] }],
        evidence: [{ startSeconds: 0, endSeconds: 1, reference: '00:00-00:01', description: `${code} synthetic evidence` }],
        observation: `${code} synthetic observation`,
        improvementSuggestions: [],
      };
    }),
    compliance: { status: options.complianceStatus ?? 'clear' as const, facts: options.complianceStatus && options.complianceStatus !== 'clear' ? ['Synthetic compliance risk'] : [] },
  };
}

test('V1.1 release acceptance uses formal content decisions and keeps Legacy content read-only', {
  skip: !releaseAcceptanceRequired,
  timeout: 240_000,
}, async (t) => {
  configureLocalAcceptance(url!);
  process.env.VIDEO_STORAGE_DIR = process.env.VIDEO_STORAGE_DIR || '/tmp/aiqc-v11-release-storage';
  const load = (module: string) => import(`../../dist/${module}`);
  const { AppModule } = await load('app.module');
  const { EvaluationJobsService } = await load('modules/evaluation-jobs/evaluation-jobs.service');
  const { EvaluationWorker } = await load('modules/evaluation-jobs/evaluation-worker');
  const { ContentReviewService } = await load('modules/ai/gemini/gemini.service');
  const { ResultReviewsService } = await load('modules/result-reviews/result-reviews.service');
  const { FinalEvaluationsService } = await load('modules/final-evaluations/final-evaluations.service');
  const { V11ContentService } = await load('modules/v11/v11-content.service');
  const { QWEN_CLIENT } = await load('modules/ai/gemini/qwen.client');
  const { TEXT_MODEL_CLIENT } = await load('modules/ai/gpt/gpt.client');
  const app = await NestFactory.create(AppModule, { logger: ['error'], abortOnError: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const db = new PrismaClient({ datasourceUrl: url });
  const users: Record<string, any> = {};
  const password = 'release-fixture-only-password';
  const passwordHash = await bcrypt.hash(password, 4);
  const media = await readFile(mediaPath!);
  assert.ok(media.length > 0, 'synthetic release media is required');
  const mediaIsWebm = media.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  const mediaMime = mediaIsWebm ? 'video/webm' : 'video/mp4';
  const mediaFilename = mediaIsWebm ? 'synthetic-release.webm' : 'synthetic-release.mp4';
  const outputs: ReturnType<typeof v11Output>[] = [];
  const calls = { content: 0, result: 0, final: 0 };
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    assert.equal(target.hostname, '127.0.0.1', 'release acceptance must not reach an external HTTP target');
    return fetchOriginal(input, { ...init, redirect: init?.redirect || 'error' });
  };

  app.get(QWEN_CLIENT).analyzeVideo = async (path: string) => {
    calls.content += 1;
    assert.ok((await stat(path)).size > 0);
    const output = outputs.shift();
    assert.ok(output, 'every provider invocation must have an explicit synthetic output');
    return { rawResponse: JSON.stringify(output), usage: { inputTokens: 10, outputTokens: 5 } };
  };
  const textResponse = (body: unknown) => ({
    responseId: randomUUID(), responseStatus: 'completed', rawText: JSON.stringify(body), model: 'local-fixture',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, usageAvailable: true,
  });
  app.get(TEXT_MODEL_CLIENT).createResultReview = async () => {
    calls.result += 1;
    return textResponse({
      dataScore: 85, dataGrade: 'A', dataSufficiency: 'sufficient', isBusinessEffectiveRecommendation: true,
      resultSummary: 'Synthetic result review', performanceProblems: [], attributionAnalysis: [],
      optimizationSuggestions: [], sufficiencyReasons: [], continueTestRecommendation: 'continue',
    });
  };
  app.get(TEXT_MODEL_CLIENT).createFinalEvaluation = async () => {
    calls.final += 1;
    throw new Error('V1.1 release acceptance must not invoke the Legacy final-evaluation model path.');
  };

  const worker = new EvaluationWorker(
    app.get(EvaluationJobsService),
    app.get(ContentReviewService),
    app.get(ResultReviewsService),
    app.get(FinalEvaluationsService),
    app.get(V11ContentService),
  ) as { runOnce(): Promise<boolean> };
  const req = (path: string, role = 'admin', method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api${path}`, {
    method,
    headers: { Origin: 'http://localhost:3000', 'X-QC-CSRF': '1', 'Content-Type': 'application/json', Cookie: users[role]?.cookie || '', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = async (response: Response, expected = 200) => {
    const body: any = await response.json();
    assert.equal(response.status, expected, JSON.stringify(body));
    return body;
  };
  const upload = async (title: string, role = 'director') => {
    const data = new FormData();
    data.append('title', title);
    data.append('videoType', 'organic');
    data.append('platform', 'fixture');
    data.append('file', new Blob([media], { type: mediaMime }), mediaFilename);
    return json(await fetch(`${base}/api/videos`, {
      method: 'POST',
      headers: { Cookie: users[role].cookie, Origin: 'http://localhost:3000', 'X-QC-CSRF': '1', 'Idempotency-Key': randomUUID() },
      body: data,
    }), 201);
  };
  const uploadRevision = async (parentVideoId: string) => {
    const data = new FormData();
    data.append('file', new Blob([media], { type: mediaMime }), mediaIsWebm ? 'synthetic-revision.webm' : 'synthetic-revision.mp4');
    return json(await fetch(`${base}/api/videos/${parentVideoId}/revisions`, {
      method: 'POST', headers: { Cookie: users.director.cookie, Origin: 'http://localhost:3000', 'X-QC-CSRF': '1', 'Idempotency-Key': randomUUID() }, body: data,
    }), 201);
  };
  const drain = async () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const pending = await db.evaluationJob.count({ where: { status: { in: ['queued', 'running', 'retry_wait'] } } });
      if (pending === 0) return;
      assert.equal(await worker.runOnce(), true, 'worker must claim the pending release job');
    }
    assert.fail('release worker did not drain within the bounded attempt count');
  };
  const trigger = async (videoId: string, role = 'director', expected = 202) => json(
    await req(`/videos/${videoId}/v11-content-review`, role, 'POST'), expected,
  );
  const latestGroup = (videoId: string) => db.v11EvaluationGroup.findFirstOrThrow({
    where: { videoId, pilotRun: false, independent: false },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { runs: { orderBy: { runNumber: 'asc' } }, decision: true, holds: true, workflowRevision: true },
  });
  const createStableDecision = async (title: string) => {
    const video = await upload(title);
    outputs.push(v11Output({ anchor: 4, actionCue: 'absent' }), v11Output({ anchor: 4, actionCue: 'absent' }));
    const queued = await trigger(video.id);
    await drain();
    const group = await latestGroup(video.id);
    assert.equal(group.status, 'adopted');
    assert.equal(group.runs.length, 2);
    assert.equal(group.runs[1].runRole, 'independent_review');
    assert.ok(group.decision);
    return { video, queued, group };
  };

  try {
    assert.equal(await db.user.count(), 0, 'release acceptance requires a fresh isolated database');
    await db.runtimeSetting.createMany({ data: [
      { key: 'v11_content_shadow', value: { enabled: true, shadowMode: false } },
      { key: 'v11_workflow_gates', value: { manualContentReviewEnabled: true, manualFinalConfirmationEnabled: true } },
    ] });
    for (const role of Object.values(UserRole)) {
      users[role] = await db.user.create({ data: {
        account: randomUUID(), name: `Release ${role}`, role, passwordHash, mustChangePassword: false,
        ...(role === 'visitor' ? { expiresAt: new Date(Date.now() + 3_600_000) } : {}),
      } });
      const login = await req('/auth/login', '', 'POST', { account: users[role].account, password });
      await json(login.clone(), 201);
      users[role].cookie = login.headers.get('set-cookie')!.split(';')[0];
    }

    await t.test('formal V1.1 HTTP entry creates the decision; Legacy POST remains read-only', async () => {
      const { video, group } = await createStableDecision('V1.1 formal entry');
      assert.equal((await req(`/videos/${video.id}/content-review`, 'director', 'POST')).status, 409);
      assert.equal(await db.aiContentReview.count({ where: { videoId: video.id } }), 0);
      assert.equal(group.decision?.adoptionMethod, 'double_average');
      assert.equal((await db.video.findUniqueOrThrow({ where: { id: video.id } })).status, 'approved_for_publish');
      assert.equal((await req(`/videos/${video.id}/v11-content-review`, '', 'POST')).status, 401);
    });

    await t.test('98.8/A+ soft action-cue conflict receives a third blind review and adopts a 2:1 majority', async () => {
      const video = await upload('98.8 A+ release fixture');
      outputs.push(
        v11Output({ actionAnchor: 3, actionCue: 'absent' }),
        v11Output({ actionAnchor: 3, actionCue: 'present' }),
        v11Output({ actionAnchor: 3, actionCue: 'absent' }),
      );
      await trigger(video.id);
      await drain();
      const group = await latestGroup(video.id);
      assert.equal(group.runs.length, 3);
      assert.deepEqual(group.runs.map((run) => run.runRole), ['primary', 'independent_review', 'third_review']);
      assert.equal(Number(group.decision?.totalScore), 98.8);
      assert.equal(group.decision?.contentRating, 'A+');
      assert.equal(group.decision?.adoptionMethod, 'triple_median');
      assert.equal(group.holds.length, 0);
    });

    await t.test('hard canonical audio conflict holds, while pure instability retry is serialized and succeeds', async () => {
      const video = await upload('hard fact conflict release fixture');
      outputs.push(v11Output({ audioPresent: 'present' }), v11Output({ audioPresent: 'absent' }));
      await trigger(video.id);
      await drain();
      const held = await latestGroup(video.id);
      assert.equal(held.status, 'hold');
      assert.equal(held.holds[0]?.holdType, 'evaluation_instability');
      assert.match(held.holds[0]?.reason || '', /major_fact_conflict/);
      const priorWorkflowId = held.workflowRevisionId;

      const [left, right] = await Promise.all([trigger(video.id), trigger(video.id)]);
      assert.equal(left.groupId, right.groupId);
      const workflows = await db.v11WorkflowRevision.findMany({ where: { videoId: video.id }, orderBy: { revision: 'asc' } });
      assert.deepEqual(workflows.map((item) => item.status), ['superseded', 'current']);
      assert.equal(workflows[0].id, priorWorkflowId);
      assert.equal(await db.v11EvaluationGroup.count({ where: { workflowRevisionId: workflows[1].id } }), 1);
      outputs.push(v11Output(), v11Output());
      await drain();
      assert.equal((await latestGroup(video.id)).status, 'adopted');
    });

    await t.test('stable C/D automatic content gate permits revision upload without a SupervisorReview row', async () => {
      const video = await upload('automatic revision gate fixture');
      outputs.push(v11Output({ anchor: 0 }), v11Output({ anchor: 0 }));
      await trigger(video.id);
      await drain();
      const group = await latestGroup(video.id);
      assert.equal(group.status, 'adopted');
      assert.equal(group.decision?.contentRating, 'D');
      assert.equal((await db.video.findUniqueOrThrow({ where: { id: video.id } })).status, 'revision_required');
      assert.equal(await db.supervisorReview.count({ where: { videoId: video.id } }), 0);
      assert.equal(await db.v11WorkflowGateDecision.count({ where: {
        videoId: video.id, stage: 'content', decision: 'revision_required', decisionSource: 'system',
        workflowRevision: { status: 'current' },
      } }), 1);
      const revision = await uploadRevision(video.id);
      assert.equal(revision.parentVideoId, video.id);
      await db.videoResultMetric.create({ data: { videoId: video.id, videoType: 'organic', views: 1000 } });
      assert.equal((await req(`/v11/videos/${video.id}/data-rating`, 'admin', 'POST')).status, 409, 'C/D content gate blocks a historical metric from advancing to data rating');
      assert.equal(await db.v11DataRatingDecision.count({ where: { videoId: video.id } }), 0);
    });

    await t.test('suspected and confirmed compliance create explicit formal holds and fail the content gate', async () => {
      for (const complianceStatus of ['suspected', 'confirmed'] as const) {
        const video = await upload(`formal compliance hold: ${complianceStatus}`);
        outputs.push(v11Output({ anchor: 4, complianceStatus }), v11Output({ anchor: 4, complianceStatus }));
        await trigger(video.id);
        await drain();
        const group = await latestGroup(video.id);
        assert.ok(group.decision, 'formal content decision is preserved for diagnostics');
        assert.equal(group.decision?.complianceStatus, complianceStatus);
        assert.equal(group.status, 'hold');
        assert.equal((await db.video.findUniqueOrThrow({ where: { id: video.id } })).status, 'ai_content_failed');
        assert.ok(group.holds.some((hold: any) => hold.status === 'active' && hold.holdType === 'compliance' && hold.reason.includes(complianceStatus)));
        assert.equal(await db.v11WorkflowGateDecision.count({ where: { videoId: video.id, stage: 'content', decision: 'hold', workflowRevision: { status: 'current' } } }), 1);
        assert.equal((await req(`/v11/videos/${video.id}/data-rating`, 'admin', 'POST')).status, 409);
      }
    });

    await t.test('active holds, appeals and suspected/confirmed compliance block the entire data stage', async () => {
      const cases = [
        { name: 'active hold', apply: async (videoId: string, workflowRevisionId: string, groupId: string) => db.v11WorkflowHold.create({ data: { videoId, workflowRevisionId, groupId, holdType: 'manual', reason: 'Synthetic active hold' } }) },
        { name: 'active appeal', apply: async (videoId: string, workflowRevisionId: string, groupId: string, decisionId: string) => {
          await db.v11Appeal.create({ data: { videoId, workflowRevisionId, stage: 'content', resultId: decisionId, reason: 'Synthetic active appeal for release acceptance', submittedById: users.director.id } });
          return db.v11WorkflowHold.create({ data: { videoId, workflowRevisionId, groupId, holdType: 'appeal', reason: 'Synthetic active appeal hold' } });
        } },
        { name: 'suspected compliance', apply: async (_videoId: string, _workflowRevisionId: string, _groupId: string, decisionId: string) => db.v11EvaluationDecision.update({ where: { id: decisionId }, data: { complianceStatus: 'suspected' } }) },
        { name: 'confirmed compliance', apply: async (_videoId: string, _workflowRevisionId: string, _groupId: string, decisionId: string) => db.v11EvaluationDecision.update({ where: { id: decisionId }, data: { complianceStatus: 'confirmed' } }) },
      ];
      for (const scenario of cases) {
        const { video, group } = await createStableDecision(`data-stage block: ${scenario.name}`);
        const metric = await json(await req(`/videos/${video.id}/result-metrics`, 'admin', 'POST', {
          baseMetricId: null, dataStartDate: '2026-10-01', dataEndDate: '2026-10-02', views: 1000,
        }), 201);
        await scenario.apply(video.id, group.workflowRevisionId, group.id, group.decision!.id);
        const secondMetric = await req(`/videos/${video.id}/result-metrics`, 'admin', 'POST', {
          baseMetricId: metric.id, dataStartDate: '2026-10-01', dataEndDate: '2026-10-02', views: 1200,
        });
        assert.equal(secondMetric.status, 409, `${scenario.name}: metric writes must be blocked`);
        const review = await req(`/videos/${video.id}/result-review`, 'admin', 'POST', { resultMetricId: metric.id });
        assert.equal(review.status, 409, `${scenario.name}: AI data review trigger must be blocked`);
        assert.equal((await req(`/v11/videos/${video.id}/data-rating`, 'admin', 'POST')).status, 409, `${scenario.name}: deterministic data rating must be blocked`);
        assert.equal((await req(`/v11/videos/${video.id}/comprehensive-rating`, 'admin', 'POST')).status, 409, `${scenario.name}: comprehensive rating must be blocked`);
        assert.equal(await db.aiResultReview.count({ where: { videoId: video.id } }), 0, `${scenario.name}: no review record`);
        assert.equal(await db.v11DataRatingDecision.count({ where: { videoId: video.id } }), 0, `${scenario.name}: no data rating record`);
        assert.equal(await db.v11ComprehensiveDecision.count({ where: { videoId: video.id } }), 0, `${scenario.name}: no comprehensive decision`);
        assert.equal(await db.evaluationJob.count({ where: { videoId: video.id, stage: 'result' } }), 0, `${scenario.name}: no job`);
      }
    });

    await t.test('hidden and trashed records remain admin-readable but business-frozen', async () => {
      const { video } = await createStableDecision('hidden/trash freeze fixture');
      const assertFrozenReadOnly = async (state: 'hide' | 'trash') => {
        await json(await req(`/videos/${video.id}/${state}`, 'admin', 'POST', { reason: `Synthetic ${state} release check` }), 201);
        assert.equal((await req(`/videos/${video.id}`)).status, 200, `admin detail remains readable while ${state}d`);
        assert.equal((await req(`/videos/${video.id}/file`)).status, 200, `admin original video remains readable while ${state}d`);
        assert.equal((await req(`/videos/${video.id}/result-metrics`, 'admin', 'POST', {
          baseMetricId: null, dataStartDate: '2026-10-01', dataEndDate: '2026-10-02', views: 1000,
        })).status, 403, `${state}d video is business-frozen`);
        assert.equal((await req(`/videos/${video.id}`, 'director')).status, 403, `non-admin cannot access ${state}d video`);
        await json(await req(`/videos/${video.id}/restore`, 'admin', 'POST', { reason: `Synthetic ${state} release restore` }), 201);
      };
      await assertFrozenReadOnly('hide');
      await assertFrozenReadOnly('trash');
    });

    await t.test('mixed instability and input holds fail closed without creating workflow, group, run or job', async () => {
      const video = await upload('mixed hold release fixture');
      outputs.push(v11Output({ audioPresent: 'present' }), v11Output({ audioPresent: 'absent' }));
      await trigger(video.id);
      await drain();
      const held = await latestGroup(video.id);
      await db.v11WorkflowHold.create({ data: {
        videoId: video.id, workflowRevisionId: held.workflowRevisionId, groupId: held.id,
        holdType: 'input_incomplete', reason: 'Synthetic mixed blocking hold',
      } });
      const before = {
        workflows: await db.v11WorkflowRevision.count({ where: { videoId: video.id } }),
        groups: await db.v11EvaluationGroup.count({ where: { videoId: video.id } }),
        runs: await db.v11EvaluationRun.count({ where: { group: { videoId: video.id } } }),
        jobs: await db.evaluationJob.count({ where: { videoId: video.id, stage: 'v11_content' } }),
      };
      const response = await req(`/videos/${video.id}/v11-content-review`, 'director', 'POST');
      assert.equal(response.status, 409);
      assert.deepEqual({
        workflows: await db.v11WorkflowRevision.count({ where: { videoId: video.id } }),
        groups: await db.v11EvaluationGroup.count({ where: { videoId: video.id } }),
        runs: await db.v11EvaluationRun.count({ where: { group: { videoId: video.id } } }),
        jobs: await db.evaluationJob.count({ where: { videoId: video.id, stage: 'v11_content' } }),
      }, before);
      assert.equal((await db.v11WorkflowRevision.findUniqueOrThrow({ where: { id: held.workflowRevisionId } })).status, 'current');
    });

    await t.test('current V1.1 content, data and comprehensive decisions complete the formal business path', async () => {
      const profile = await json(await req('/v11/benchmark-profiles', 'admin', 'POST', {
        name: 'Release fixture benchmark', platform: 'fixture', videoType: 'organic', primaryMetric: 'views',
        requiredMetrics: ['views'], minimumSampleMetric: 'views', minimumSampleValue: 100,
        observationWindowDays: 2, guardRules: [],
        thresholds: { direction: 'higher_better', S: 1000, 'A+': 900, A: 800, B: 700, 'B-': 600, C: 500 },
      }), 201);
      await json(await req(`/v11/benchmark-profiles/${profile.id}/approve`, 'admin', 'POST', {
        reason: 'Synthetic release benchmark approval.',
      }), 201);
      const { video, group } = await createStableDecision('V1.1 formal business path');
      const legacySupervisorPost = await req(`/videos/${video.id}/supervisor-review`, 'admin', 'POST', {
        decision: 'approved_for_publish', comment: 'Synthetic supervisor approval',
      });
      assert.equal(legacySupervisorPost.status, 409);
      const metric = await json(await req(`/videos/${video.id}/result-metrics`, 'admin', 'POST', {
        baseMetricId: null, dataStartDate: '2026-10-01', dataEndDate: '2026-10-02', views: 1000,
      }), 201);
      const resultQueued = await json(await req(`/videos/${video.id}/result-review`, 'admin', 'POST', {
        resultMetricId: metric.id,
      }), 202);
      await drain();
      assert.equal((await db.evaluationJob.findUniqueOrThrow({ where: { id: resultQueued.jobId } })).status, 'succeeded');
      const data = await json(await req(`/v11/videos/${video.id}/data-rating`, 'admin', 'POST'), 201);
      assert.equal(data.dataRating, 'S');
      const comprehensive = await json(await req(`/v11/videos/${video.id}/comprehensive-rating`, 'admin', 'POST'), 201);
      assert.equal(comprehensive.comprehensiveRating, 'S');
      assert.equal(comprehensive.finalStatus, null);
      const final = await json(await req(`/v11/videos/${video.id}/comprehensive-rating/confirm`, 'admin', 'POST', {
        decisionId: comprehensive.id, reason: 'Synthetic release evidence confirms this decision.', performanceEligible: true,
      }), 201);
      assert.equal(final.finalStatus, 'final_effective');
      assert.equal(final.performanceEligible, true);
      assert.equal((await db.video.findUniqueOrThrow({ where: { id: video.id } })).status, 'final_effective');
      assert.equal(group.decision?.id, (await db.v11WorkflowRevision.findFirstOrThrow({ where: { videoId: video.id, status: 'current' } })).activeContentDecisionId);
      assert.equal(calls.final, 0);
    });

    assert.equal(outputs.length, 0);
    assert.equal(await db.evaluationJob.count({ where: { status: { in: ['queued', 'running', 'retry_wait'] } } }), 0);
  } finally {
    globalThis.fetch = fetchOriginal;
    await app.close();
    await db.$disconnect();
  }
});
