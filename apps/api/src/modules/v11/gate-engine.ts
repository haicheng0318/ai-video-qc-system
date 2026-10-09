import { V11ContentRating } from './content-scoring';

export function evaluateContentGate(input: {
  manualEnabled: boolean;
  rating: V11ContentRating | null;
  stable: boolean;
  inputComplete: boolean;
  complianceStatus: 'clear' | 'suspected' | 'confirmed';
  hasHold: boolean;
  hasAppeal: boolean;
  stale: boolean;
}) {
  if (input.manualEnabled) return { decision: 'manual_review' as const, decisionSource: null };
  if (!input.stable || !input.inputComplete || input.complianceStatus !== 'clear' || input.hasHold || input.hasAppeal || input.stale || !input.rating) {
    return { decision: 'hold' as const, decisionSource: null };
  }
  return ['A+', 'A', 'B', 'B-'].includes(input.rating)
    ? { decision: 'approved' as const, decisionSource: 'system' as const }
    : { decision: 'revision_required' as const, decisionSource: 'system' as const };
}

export function evaluateFinalGate(input: {
  manualEnabled: boolean;
  dataSufficient: boolean;
  deterministicRuleClear: boolean;
  comprehensiveConsistent: boolean;
  hasSafetyGate: boolean;
  finalStatus: 'final_effective' | 'final_low_effective' | 'final_invalid';
}) {
  if (input.manualEnabled) return { decision: 'manual_confirmation' as const, decisionSource: null, actorId: null, performanceEligible: false };
  if (!input.dataSufficient || !input.deterministicRuleClear || !input.comprehensiveConsistent || input.hasSafetyGate) {
    return { decision: 'hold' as const, decisionSource: null, actorId: null, performanceEligible: false };
  }
  return { decision: input.finalStatus, decisionSource: 'system' as const, actorId: null, performanceEligible: false };
}
