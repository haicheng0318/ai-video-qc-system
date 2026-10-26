import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { V11_CONTENT_DIMENSIONS } from '../modules/v11/content-scoring';
import { V11_FACT_CLAIMS } from '../modules/v11/fact-claims';
import { sha256File } from '../modules/v11/provenance';
import { V11ContentService } from '../modules/v11/v11-content.service';

let sequence = 1;
const uuid = () => `30000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`;

function modelOutput(overrides: Partial<Record<(typeof V11_CONTENT_DIMENSIONS)[number]['code'], number>> = {}, audioState: 'present' | 'absent' | 'uncertain' = 'present') {
  return {
    dimensions: V11_CONTENT_DIMENSIONS.map(({ code }) => ({
      dimension: code,
      observationStatus: 'observed',
      anchor: overrides[code] ?? 3,
      facts: [`${code} observed`],
      factClaims: [{
        key: V11_FACT_CLAIMS[code][0],
        state: code === 'subtitle_audio' && V11_FACT_CLAIMS[code][0] === 'audio_present' ? audioState : 'present',
        evidenceReferences: ['00:00-00:01'],
      }],
      evidence: [{ startSeconds: 0, endSeconds: 1, reference: '00:00-00:01', description: `${code} evidence` }],
      observation: `${code} observation`,
      improvementSuggestions: [],
    })),
    compliance: { status: 'clear', facts: [] },
  };
}

async function pilotHarness(output: ReturnType<typeof modelOutput>, inputComplete = true, fingerprint = 'same-pilot-fingerprint') {
  const directory = await mkdtemp(join(tmpdir(), 'v11-pilot-execution-'));
  const path = join(directory, 'fixture.mp4');
  await writeFile(path, 'same frozen pilot media bytes');
  const fileHash = await sha256File(path);
  const ids = { video: uuid(), owner: uuid(), actor: uuid(), workflow: uuid(), group: uuid(), input: uuid(), run: uuid(), job: uuid() };
  const workflow = { id: ids.workflow, status: 'current', activeContentDecisionId: 'existing-decision' };
  const group: any = {
    id: ids.group,
    videoId: ids.video,
    inputRevisionId: ids.input,
    workflowRevisionId: ids.workflow,
    triggerReason: 'pilot_independent',
    shadowMode: true,
    independent: true,
    pilotRun: true,
    status: 'queued',
    technicalAttemptCount: 0,
    validRunCount: 0,
    inputRevision: {
      id: ids.input,
      fileHash,
      inputComplete,
      evaluationFingerprint: fingerprint,
      metadataSnapshot: {},
      mediaManifest: { durationSeconds: null, hasAudio: true },
      rubricVersion: 'rubric',
      ratingVersion: 'rating',
      preprocessingVersion: 'preprocess',
    },
    workflowRevision: workflow,
  };
  const run: any = {
    id: ids.run,
    groupId: ids.group,
    runNumber: 1,
    runRole: 'primary',
    status: 'pending',
    blindContextHash: 'blind',
    modelProvider: 'aliyun_bailian',
    modelName: 'qwen',
    modelConfigSnapshot: { provider: 'aliyun_bailian', modelName: 'qwen', temperature: null, maxTokens: null, region: 'cn' },
    promptVersion: 'prompt',
    schemaVersion: 'schema',
    rubricVersion: 'rubric',
    ratingVersion: 'rating',
    preprocessingVersion: 'preprocess',
    referenceSetVersion: 'reference',
    technicalAttempts: 0,
    group,
  };
  const video = { id: ids.video, filePath: 'fixture.mp4', fileSizeBytes: BigInt(29), duration: null, mimeType: 'video/mp4', status: 'submitted' };
  const effects = { providerCalls: 0, decisions: 0, holds: 0, gates: 0, workflowUpdates: 0, videoUpdates: 0, enqueuedReviews: 0, finish: [] as string[] };
  const tx: any = {
    $queryRaw: async () => { throw new Error('Pilot must not query business review eligibility.'); },
    v11EvaluationGroup: {
      findUniqueOrThrow: async () => group,
      update: async ({ data }: any) => { Object.assign(group, data.status ? { status: data.status } : {}, data.validRunCount === undefined ? {} : { validRunCount: data.validRunCount }); if (data.technicalAttemptCount?.increment) group.technicalAttemptCount += data.technicalAttemptCount.increment; return group; },
      updateMany: async () => ({ count: 0 }),
    },
    v11EvaluationRun: {
      update: async ({ data }: any) => { Object.assign(run, data); return run; },
      updateMany: async ({ data }: any) => { Object.assign(run, data); return { count: 1 }; },
      findMany: async () => run.status === 'succeeded' ? [run] : [],
      create: async () => { effects.enqueuedReviews += 1; throw new Error('Pilot must not create another run.'); },
    },
    v11WorkflowRevision: {
      findUniqueOrThrow: async () => workflow,
      update: async () => { effects.workflowUpdates += 1; throw new Error('Pilot must not update workflow.'); },
    },
    v11WorkflowHold: { create: async () => { effects.holds += 1; throw new Error('Pilot must not create a hold.'); } },
    v11EvaluationDecision: {
      findFirst: async () => { throw new Error('Pilot must not query adopted decisions.'); },
      create: async () => { effects.decisions += 1; throw new Error('Pilot must not create a decision.'); },
    },
    v11WorkflowGateDecision: { create: async () => { effects.gates += 1; throw new Error('Pilot must not create a gate decision.'); } },
    v11Appeal: { updateMany: async () => { throw new Error('Pilot must not resolve appeals.'); } },
    video: { update: async () => { effects.videoUpdates += 1; throw new Error('Pilot must not update video status.'); } },
  };
  const db: any = {
    v11EvaluationRun: { findUnique: async () => run },
    video: { findUniqueOrThrow: async () => video },
    $transaction: async (callback: (client: any) => unknown) => callback(tx),
  };
  const jobs: any = {
    assertCurrent: async () => undefined,
    markExternalStarted: async () => undefined,
    finishCurrent: async (_tx: unknown, status: string) => { effects.finish.push(status); },
    enqueue: async () => { effects.enqueuedReviews += 1; throw new Error('Pilot must not enqueue another job.'); },
  };
  const service = new V11ContentService(
    db,
    {} as any,
    { create: async () => ({ id: uuid() }) } as any,
    { materialize: async () => ({ path, cleanup: async () => undefined }) } as any,
    jobs,
    { analyzeVideo: async () => { effects.providerCalls += 1; return { rawResponse: JSON.stringify(output) }; } } as any,
  );
  const job = { id: ids.job, videoId: ids.video, actorId: ids.actor, v11RunId: ids.run, attempts: 1 } as any;
  return { service, job, run, group, workflow, video, effects, fingerprint, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test('pilot A+ and boundary runs complete once without entering business review or adoption', async () => {
  const cases = [
    await pilotHarness(modelOutput(Object.fromEntries(V11_CONTENT_DIMENSIONS.map(({ code }) => [code, 4])))),
    await pilotHarness(modelOutput({ opening_hook: 4, pacing: 4 })),
  ];
  try {
    for (const harness of cases) {
      const original = { pointer: harness.workflow.activeContentDecisionId, videoStatus: harness.video.status };
      await harness.service.executeJob(harness.job);
      assert.equal(harness.effects.providerCalls, 1);
      assert.equal(harness.run.status, 'succeeded');
      assert.equal(harness.group.status, 'pilot_completed');
      assert.equal(harness.group.validRunCount, 1);
      assert.equal(harness.effects.decisions, 0);
      assert.equal(harness.effects.holds, 0);
      assert.equal(harness.effects.gates, 0);
      assert.equal(harness.effects.enqueuedReviews, 0);
      assert.equal(harness.effects.workflowUpdates, 0);
      assert.equal(harness.effects.videoUpdates, 0);
      assert.equal(harness.workflow.activeContentDecisionId, original.pointer);
      assert.equal(harness.video.status, original.videoStatus);
    }
  } finally {
    await Promise.all(cases.map((harness) => harness.cleanup()));
  }
});

test('three pilot requests remain three independent provider calls with one run each and the same fingerprint', async () => {
  const pilots = await Promise.all([1, 2, 3].map(() => pilotHarness(modelOutput(), true, 'identical-fingerprint')));
  try {
    for (const pilot of pilots) await pilot.service.executeJob(pilot.job);
    assert.equal(new Set(pilots.map(({ group }) => group.id)).size, 3);
    assert.equal(new Set(pilots.map(({ run }) => run.id)).size, 3);
    assert.equal(new Set(pilots.map(({ job }) => job.id)).size, 3);
    assert.equal(new Set(pilots.map(({ fingerprint }) => fingerprint)).size, 1);
    assert.equal(pilots.reduce((sum, pilot) => sum + pilot.effects.providerCalls, 0), 3);
    assert.ok(pilots.every((pilot) => pilot.group.validRunCount === 1 && pilot.group.status === 'pilot_completed'));
    assert.ok(pilots.every((pilot) => pilot.effects.decisions + pilot.effects.holds + pilot.effects.gates + pilot.effects.videoUpdates === 0));
  } finally {
    await Promise.all(pilots.map((pilot) => pilot.cleanup()));
  }
});

test('pilot contradiction and incomplete input are audit results, not business review side effects', async () => {
  const contradicted = await pilotHarness(modelOutput({}, 'absent'));
  const incomplete = await pilotHarness(modelOutput(), false);
  try {
    await contradicted.service.executeJob(contradicted.job);
    await incomplete.service.executeJob(incomplete.job);
    assert.equal(contradicted.effects.providerCalls, 1);
    assert.equal(contradicted.group.status, 'pilot_completed');
    assert.equal(incomplete.effects.providerCalls, 1);
    assert.equal(incomplete.group.status, 'pilot_incomplete');
    assert.equal(contradicted.effects.enqueuedReviews + incomplete.effects.enqueuedReviews, 0);
    assert.equal(contradicted.effects.holds + incomplete.effects.holds, 0);
  } finally {
    await Promise.all([contradicted.cleanup(), incomplete.cleanup()]);
  }
});
