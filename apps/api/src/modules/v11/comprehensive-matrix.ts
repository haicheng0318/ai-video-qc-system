import { V11ContentRating } from './content-scoring';
import { V11DataRating } from './data-rating-engine';

export const V11_COMPREHENSIVE_MATRIX_VERSION = 'comprehensive-matrix-v1.1-r1';
export type V11ComprehensiveRating = V11DataRating;

const matrix: Record<V11ContentRating, Record<V11DataRating, V11ComprehensiveRating | 'R'>> = {
  'A+': { S: 'S', 'A+': 'A+', A: 'A', B: 'A', 'B-': 'B', C: 'B-', D: 'C' },
  A: { S: 'A+', 'A+': 'A+', A: 'A', B: 'B', 'B-': 'B-', C: 'C', D: 'C' },
  B: { S: 'A', 'A+': 'A', A: 'A', B: 'B', 'B-': 'B-', C: 'C', D: 'D' },
  'B-': { S: 'R', 'A+': 'R', A: 'B', B: 'B-', 'B-': 'C', C: 'C', D: 'D' },
  C: { S: 'R', 'A+': 'R', A: 'R', B: 'R', 'B-': 'C', C: 'D', D: 'D' },
  D: { S: 'R', 'A+': 'R', A: 'R', B: 'R', 'B-': 'C', C: 'D', D: 'D' },
};

export function comprehensiveRatingFor(content: V11ContentRating, data: V11DataRating) {
  const rating = matrix[content][data];
  if (rating === 'R') return { comprehensiveRating: null, requiresAdminReview: true, businessConclusion: null, finalStatus: null, isEffectiveFinal: null };
  return { comprehensiveRating: rating, requiresAdminReview: false, ...businessOutcomeFor(rating) };
}

export function businessOutcomeFor(rating: V11ComprehensiveRating): {
  businessConclusion: 'effective' | 'low_effective' | 'invalid';
  finalStatus: 'final_effective' | 'final_low_effective' | 'final_invalid';
  isEffectiveFinal: boolean;
} {
  if (['S', 'A+', 'A', 'B'].includes(rating)) return { businessConclusion: 'effective', finalStatus: 'final_effective', isEffectiveFinal: true };
  if (['B-', 'C'].includes(rating)) return { businessConclusion: 'low_effective', finalStatus: 'final_low_effective', isEffectiveFinal: true };
  return { businessConclusion: 'invalid', finalStatus: 'final_invalid', isEffectiveFinal: false };
}

export function resolveManualR(rating: V11ComprehensiveRating) {
  if (rating === 'S' || rating === 'A+') throw new Error('R combinations cannot be manually resolved as S or A+. Create a new workflow revision.');
  return rating;
}

export const V11_COMPREHENSIVE_MATRIX = matrix;
