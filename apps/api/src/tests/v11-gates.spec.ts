import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateContentGate, evaluateFinalGate } from '../modules/v11/gate-engine';

const content = { manualEnabled: false, rating: 'B' as const, stable: true, inputComplete: true, complianceStatus: 'clear' as const, hasHold: false, hasAppeal: false, stale: false };

test('automatic content gate passes only stable complete clear A+ through B-minus results', () => {
  for (const rating of ['A+', 'A', 'B', 'B-'] as const) assert.equal(evaluateContentGate({ ...content, rating }).decision, 'approved');
  for (const rating of ['C', 'D'] as const) assert.equal(evaluateContentGate({ ...content, rating }).decision, 'revision_required');
});

test('manual content gate and every frozen safety gate prevent automatic approval', () => {
  assert.equal(evaluateContentGate({ ...content, manualEnabled: true }).decision, 'manual_review');
  for (const patch of [{ stable: false }, { inputComplete: false }, { complianceStatus: 'suspected' as const }, { hasHold: true }, { hasAppeal: true }, { stale: true }]) {
    assert.equal(evaluateContentGate({ ...content, ...patch }).decision, 'hold');
  }
});

test('automatic final gate requires sufficient data, clear deterministic rules and consistent comprehensive result', () => {
  const safe = { manualEnabled: false, dataSufficient: true, deterministicRuleClear: true, comprehensiveConsistent: true, hasSafetyGate: false, finalStatus: 'final_effective' as const };
  const result = evaluateFinalGate(safe);
  assert.equal(result.decision, 'final_effective');
  assert.equal(result.decisionSource, 'system');
  assert.equal(result.actorId, null);
  assert.equal(result.performanceEligible, false);
  for (const patch of [{ dataSufficient: false }, { deterministicRuleClear: false }, { comprehensiveConsistent: false }, { hasSafetyGate: true }]) {
    assert.equal(evaluateFinalGate({ ...safe, ...patch }).decision, 'hold');
  }
});

test('invalid automatic result can never be performance eligible', () => {
  const result = evaluateFinalGate({ manualEnabled: false, dataSufficient: true, deterministicRuleClear: true, comprehensiveConsistent: true, hasSafetyGate: false, finalStatus: 'final_invalid' });
  assert.equal(result.performanceEligible, false);
});
