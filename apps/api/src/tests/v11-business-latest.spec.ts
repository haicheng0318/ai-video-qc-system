import assert from 'node:assert/strict';
import { test } from 'node:test';
import { V11ContentService } from '../modules/v11/v11-content.service';

test('business latest follows the active adopted decision and excludes newer pilot groups', async () => {
  const activeDecisionId = '50000000-0000-4000-8000-000000000001';
  const business = { id: 'business-group', pilotRun: false, independent: false, decision: { id: activeDecisionId, contentRating: 'B' } };
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
