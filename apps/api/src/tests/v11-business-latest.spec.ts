import assert from 'node:assert/strict';
import { test } from 'node:test';
import { V11ContentService } from '../modules/v11/v11-content.service';
import { V11_CONTENT_DIMENSIONS } from '../modules/v11/content-scoring';

test('business latest follows the active adopted decision and excludes newer pilot groups', async () => {
  const activeDecisionId = '50000000-0000-4000-8000-000000000001';
  const business = { id: 'business-group', pilotRun: false, independent: false, runs: [], decision: { id: activeDecisionId, contentRating: 'B' } };
  const queries: any[] = [];
  const db = {
    v11WorkflowRevision: { findFirst: async () => ({ activeContentDecisionId: activeDecisionId }) },
    v11EvaluationGroup: { findFirst: async (query: any) => { queries.push(query); return business; } },
  };
  const service = new V11ContentService(
    db as any,
    { findVideoVisibleToUser: async () => ({ id: 'video' }) } as any,
    {} as any, {} as any, {} as any, {} as any,
  );

  const result = await service.latest('50000000-0000-4000-8000-000000000002', { id: 'owner', role: 'director' } as any);
  assert.equal(result.group?.decision?.contentRating, 'B');
  assert.equal(queries.length, 1);
  assert.equal(queries[0].where.pilotRun, false);
  assert.equal(queries[0].where.independent, false);
  assert.equal(queries[0].where.decision.is.id, activeDecisionId);
});

test('latest returns adopted diagnostics to owners but keeps full run structure in admin technical details', async () => {
  const decisionId = '50000000-0000-4000-8000-000000000011';
  const structuredOutput = { dimensions: V11_CONTENT_DIMENSIONS.map(({ code }) => ({ dimension: code, observationStatus: 'observed', anchor: 3, observation: code, facts: ['fact'], factClaims: [], evidence: [], improvementSuggestions: [] })), compliance: { status: 'clear', facts: [] } };
  const group = {
    id: 'group', status: 'adopted', shadowMode: false,
    inputRevision: { factClaimVersion: 'facts-v1' },
    runs: [{ id: 'run', runNumber: 1, runRole: 'primary', status: 'succeeded', totalScore: 75, contentRating: 'B', complianceStatus: 'clear', stale: false, structuredOutput, promptVersion: 'prompt-v1', schemaVersion: 'schema-v1', rubricVersion: 'rubric-v1', modelProvider: 'aliyun_bailian', modelName: 'qwen-test' }],
    decision: { id: decisionId, sourceRunIds: ['run'], adoptedDimensions: V11_CONTENT_DIMENSIONS.map(({ code }) => ({ dimension: code, anchor: 3 })), totalScore: 75, contentRating: 'B', complianceStatus: 'clear', inputComplete: true, stable: true, decisionSource: 'system', adoptionMethod: 'single' },
    workflowRevision: { revision: 1, status: 'current' },
  };
  async function load(role: string) {
    const db = { v11WorkflowRevision: { findFirst: async () => ({ activeContentDecisionId: decisionId }) }, v11EvaluationGroup: { findFirst: async () => group } };
    const service = new V11ContentService(db as any, { findVideoVisibleToUser: async () => ({ id: 'video' }) } as any, {} as any, {} as any, {} as any, {} as any);
    return service.latest('50000000-0000-4000-8000-000000000002', { id: 'actor', role } as any);
  }
  const owner = await load('director');
  assert.equal((owner as any).dimensions.length, 8);
  assert.equal((owner as any).group?.runs[0].structuredOutput, undefined);
  assert.equal((owner as any).group?.runs[0].promptVersion, undefined);
  const admin = await load('admin');
  assert.equal((admin.group?.runs[0] as any).structuredOutput, structuredOutput);
  assert.equal((admin.group?.runs[0] as any).promptVersion, 'prompt-v1');
  assert.equal((admin.group?.runs[0] as any).factClaimVersion, 'facts-v1');
});
