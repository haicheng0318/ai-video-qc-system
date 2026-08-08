import { FinalRecommendationGrade } from './final-evaluation';
import { RecommendedBoundary } from './rule-engine';

export const finalGrades = ['effective', 'low_effective', 'invalid'] as const;
export const caseTypes = ['excellent', 'negative', 'none'] as const;

export type FinalGrade = (typeof finalGrades)[number];
export type CaseType = (typeof caseTypes)[number];

export const allowedFinalGradesByBoundary: Record<RecommendedBoundary, readonly FinalGrade[]> = {
  allow_final_effective: ['effective'],
  allow_final_effective_or_low_effective: ['effective', 'low_effective'],
  allow_final_low_effective_or_invalid: ['low_effective', 'invalid'],
  require_manual_confirmation: ['effective', 'low_effective', 'invalid'],
  require_final_invalid: ['invalid'],
  pending_data: [],
};

export const finalStatusByGrade = {
  effective: 'final_effective',
  low_effective: 'final_low_effective',
  invalid: 'final_invalid',
} as const;

export function allowedFinalGrades(boundary: RecommendedBoundary) {
  return allowedFinalGradesByBoundary[boundary];
}

export function deriveFinalStatus(grade: FinalGrade) {
  return finalStatusByGrade[grade];
}

export function deriveIsEffectiveFinal(grade: FinalGrade) {
  return grade !== 'invalid';
}

export function isAdjustment(finalGrade: FinalGrade, recommendation: FinalRecommendationGrade | null) {
  return recommendation !== null && finalGrade !== recommendation;
}
