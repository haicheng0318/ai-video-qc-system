import { z } from 'zod';
import { RecommendedBoundary } from '@ai-video-qc/shared';
import { FinalEvaluationOutputValidationError } from './gpt.errors';

export const finalRecommendationGrades = ['effective', 'low_effective', 'invalid'] as const;
export type FinalRecommendationGrade = (typeof finalRecommendationGrades)[number];

const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const evidenceSource = z.enum(['content_review', 'supervisor_review', 'result_metric', 'result_review', 'rule_engine']);
const riskCode = z.enum([
  'content_data_conflict',
  'boundary_sensitive',
  'weak_evidence',
  'business_context_missing',
  'compliance_attention',
  'other',
]);

const evidenceAssessmentSchema = z.object({
  source: evidenceSource,
  strength: z.enum(['high', 'medium', 'low']),
  evidence: z.array(boundedText(500)).min(1).max(8),
  conclusion: boundedText(1000),
}).strict();

const finalAttributionSchema = z.object({
  type: z.enum(['content', 'delivery', 'audience', 'price', 'product_page', 'live_room', 'activity', 'sample_size', 'external', 'mixed']),
  confidence: z.number().int().min(0).max(100),
  evidence: z.array(boundedText(500)).min(1).max(8),
  conclusion: boundedText(1000),
}).strict();

const riskFlagSchema = z.object({
  code: riskCode,
  description: boundedText(1000),
}).strict();

export const FinalEvaluationOutputSchema = z.object({
  recommendedFinalGrade: z.enum(finalRecommendationGrades),
  recommendedFinalStatus: z.enum(['final_effective', 'final_low_effective', 'final_invalid']),
  recommendedIsEffective: z.boolean(),
  recommendationConfidence: z.number().int().min(0).max(100),
  decisionSummary: boundedText(2000),
  evidenceAssessment: z.array(evidenceAssessmentSchema).min(3).max(10),
  finalAttribution: z.array(finalAttributionSchema).min(1).max(10),
  finalSuggestion: boundedText(2000),
  confirmationFocus: z.array(boundedText(500)).min(1).max(10),
  riskFlags: z.array(riskFlagSchema).max(10),
}).strict();

export type FinalEvaluationOutput = z.infer<typeof FinalEvaluationOutputSchema>;

const mappings: Record<FinalRecommendationGrade, { status: FinalEvaluationOutput['recommendedFinalStatus']; effective: boolean }> = {
  effective: { status: 'final_effective', effective: true },
  low_effective: { status: 'final_low_effective', effective: true },
  invalid: { status: 'final_invalid', effective: false },
};

const boundaryRecommendations: Record<Exclude<RecommendedBoundary, 'pending_data'>, readonly FinalRecommendationGrade[]> = {
  allow_final_effective: ['effective'],
  allow_final_effective_or_low_effective: ['effective', 'low_effective'],
  allow_final_low_effective_or_invalid: ['low_effective', 'invalid'],
  require_manual_confirmation: ['effective', 'low_effective', 'invalid'],
  require_final_invalid: ['invalid'],
};

const forbiddenConclusion = /已最终确认|负责人已确认|已计入绩效|已完成最终审批|confirmed by owner|performance approved/i;

export function allowedRecommendations(boundary: RecommendedBoundary): readonly FinalRecommendationGrade[] {
  if (boundary === 'pending_data') return [];
  return boundaryRecommendations[boundary];
}

export function validateFinalEvaluationOutput(
  value: unknown,
  boundary: RecommendedBoundary,
): FinalEvaluationOutput {
  const parsed = FinalEvaluationOutputSchema.safeParse(value);
  if (!parsed.success) {
    throw new FinalEvaluationOutputValidationError('GPT final evaluation output failed validation.');
  }
  if (boundary === 'pending_data') {
    throw new FinalEvaluationOutputValidationError('Pending data cannot enter final evaluation.');
  }
  const output = parsed.data;
  const expected = mappings[output.recommendedFinalGrade];
  if (output.recommendedFinalStatus !== expected.status || output.recommendedIsEffective !== expected.effective) {
    throw new FinalEvaluationOutputValidationError('Final recommendation mapping is inconsistent.');
  }
  if (!allowedRecommendations(boundary).includes(output.recommendedFinalGrade)) {
    throw new FinalEvaluationOutputValidationError('Final recommendation exceeds the rule boundary.');
  }
  const sources = new Set(output.evidenceAssessment.map((item) => item.source));
  for (const required of ['content_review', 'result_review', 'rule_engine'] as const) {
    if (!sources.has(required)) {
      throw new FinalEvaluationOutputValidationError(`Evidence assessment must include ${required}.`);
    }
  }
  if (boundary === 'require_manual_confirmation') {
    const hasBoundaryRisk = output.riskFlags.some((item) =>
      item.code === 'content_data_conflict' || item.code === 'boundary_sensitive');
    if (!hasBoundaryRisk || !/(偏差|冲突|不一致|差异)/.test(output.decisionSummary)) {
      throw new FinalEvaluationOutputValidationError('Manual confirmation boundary requires conflict evidence.');
    }
  }
  const guardedTexts = [
    output.decisionSummary,
    output.finalSuggestion,
    ...output.confirmationFocus,
    ...output.riskFlags.map((item) => item.description),
  ];
  if (guardedTexts.some((text) => forbiddenConclusion.test(text))) {
    throw new FinalEvaluationOutputValidationError('Final recommendation contains a prohibited confirmed conclusion.');
  }
  return output;
}

const text = (maximum: number) => ({ type: 'string', minLength: 1, maxLength: maximum } as const);
const evidenceItems = { type: 'array', minItems: 1, maxItems: 8, items: text(500) } as const;

export const finalEvaluationJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'recommendedFinalGrade', 'recommendedFinalStatus', 'recommendedIsEffective',
    'recommendationConfidence', 'decisionSummary', 'evidenceAssessment',
    'finalAttribution', 'finalSuggestion', 'confirmationFocus', 'riskFlags',
  ],
  properties: {
    recommendedFinalGrade: { type: 'string', enum: finalRecommendationGrades },
    recommendedFinalStatus: { type: 'string', enum: ['final_effective', 'final_low_effective', 'final_invalid'] },
    recommendedIsEffective: { type: 'boolean' },
    recommendationConfidence: { type: 'integer', minimum: 0, maximum: 100 },
    decisionSummary: text(2000),
    evidenceAssessment: {
      type: 'array', minItems: 3, maxItems: 10,
      items: {
        type: 'object', additionalProperties: false,
        required: ['source', 'strength', 'evidence', 'conclusion'],
        properties: {
          source: { type: 'string', enum: ['content_review', 'supervisor_review', 'result_metric', 'result_review', 'rule_engine'] },
          strength: { type: 'string', enum: ['high', 'medium', 'low'] },
          evidence: evidenceItems,
          conclusion: text(1000),
        },
      },
    },
    finalAttribution: {
      type: 'array', minItems: 1, maxItems: 10,
      items: {
        type: 'object', additionalProperties: false,
        required: ['type', 'confidence', 'evidence', 'conclusion'],
        properties: {
          type: { type: 'string', enum: ['content', 'delivery', 'audience', 'price', 'product_page', 'live_room', 'activity', 'sample_size', 'external', 'mixed'] },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
          evidence: evidenceItems,
          conclusion: text(1000),
        },
      },
    },
    finalSuggestion: text(2000),
    confirmationFocus: { type: 'array', minItems: 1, maxItems: 10, items: text(500) },
    riskFlags: {
      type: 'array', maxItems: 10,
      items: {
        type: 'object', additionalProperties: false,
        required: ['code', 'description'],
        properties: {
          code: { type: 'string', enum: ['content_data_conflict', 'boundary_sensitive', 'weak_evidence', 'business_context_missing', 'compliance_attention', 'other'] },
          description: text(1000),
        },
      },
    },
  },
} as const;
