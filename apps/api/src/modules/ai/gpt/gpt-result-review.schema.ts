import { z } from 'zod';
import { ResultReviewOutputValidationError } from './gpt.errors';

const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const gradeSchema = z.enum(['S', 'A', 'B', 'C', 'D']);
const prioritySchema = z.enum(['high', 'medium', 'low']);

const sufficiencyReasonSchema = z.object({
  code: z.enum([
    'missing_core_metric',
    'sample_too_small',
    'period_too_short',
    'missing_benchmark',
    'inconsistent_data',
    'other',
  ]),
  description: boundedText(1000),
  requiredNextData: z.array(boundedText(500)).max(8),
}).strict();

const performanceProblemSchema = z.object({
  metric: boundedText(100),
  severity: prioritySchema,
  observedValue: z.string().max(200).nullable(),
  benchmarkValue: z.string().max(200).nullable(),
  description: boundedText(1000),
}).strict();

const attributionSchema = z.object({
  type: z.enum([
    'content',
    'delivery',
    'audience',
    'price',
    'product_page',
    'live_room',
    'activity',
    'sample_size',
    'external',
  ]),
  confidence: z.number().int().min(0).max(100),
  evidence: z.array(boundedText(500)).max(8),
  conclusion: boundedText(1000),
}).strict();

const suggestionSchema = z.object({
  priority: prioritySchema,
  owner: z.enum(['content', 'delivery', 'operation', 'product', 'live_room', 'cross_function']),
  action: boundedText(1000),
  rationale: boundedText(1000),
}).strict();

export const ResultReviewOutputSchema = z.object({
  dataSufficiency: z.enum(['sufficient', 'insufficient']),
  sufficiencyReasons: z.array(sufficiencyReasonSchema).max(10),
  dataScore: z.number().int().min(0).max(100).nullable(),
  dataGrade: gradeSchema.nullable(),
  isBusinessEffectiveRecommendation: z.boolean().nullable(),
  resultSummary: boundedText(2000),
  performanceProblems: z.array(performanceProblemSchema).max(10),
  attributionAnalysis: z.array(attributionSchema).max(9),
  optimizationSuggestions: z.array(suggestionSchema).max(10),
  continueTestRecommendation: z.enum([
    'continue',
    'optimize_then_continue',
    'pause',
    'collect_more_data',
  ]),
}).strict().superRefine((value, context) => {
  if (value.dataSufficiency === 'insufficient') {
    if (value.dataScore !== null) addIssue(context, ['dataScore'], 'dataScore must be null when data is insufficient');
    if (value.dataGrade !== null) addIssue(context, ['dataGrade'], 'dataGrade must be null when data is insufficient');
    if (value.isBusinessEffectiveRecommendation !== null) {
      addIssue(context, ['isBusinessEffectiveRecommendation'], 'recommendation must be null when data is insufficient');
    }
    if (value.sufficiencyReasons.length === 0) {
      addIssue(context, ['sufficiencyReasons'], 'at least one insufficiency reason is required');
    }
    if (value.continueTestRecommendation !== 'collect_more_data') {
      addIssue(context, ['continueTestRecommendation'], 'insufficient data must request more data');
    }
    const hasEvidence = value.attributionAnalysis.some((item) => item.type === 'sample_size') ||
      value.sufficiencyReasons.some((item) =>
        ['missing_benchmark', 'missing_core_metric', 'sample_too_small', 'period_too_short'].includes(item.code));
    if (!hasEvidence) {
      addIssue(context, ['attributionAnalysis'], 'insufficient data requires sample-size or missing-data evidence');
    }
    return;
  }

  if (value.dataScore === null) addIssue(context, ['dataScore'], 'dataScore is required when data is sufficient');
  if (value.dataGrade === null) addIssue(context, ['dataGrade'], 'dataGrade is required when data is sufficient');
  if (value.isBusinessEffectiveRecommendation === null) {
    addIssue(context, ['isBusinessEffectiveRecommendation'], 'recommendation is required when data is sufficient');
  }
  if (value.sufficiencyReasons.length > 0) {
    addIssue(context, ['sufficiencyReasons'], 'sufficient data must not include insufficiency reasons');
  }
  if (value.dataScore !== null && value.dataGrade !== gradeForScore(value.dataScore)) {
    addIssue(context, ['dataGrade'], `dataGrade must match dataScore band ${gradeForScore(value.dataScore)}`);
  }
});

function addIssue(context: z.RefinementCtx, path: PropertyKey[], message: string) {
  context.addIssue({ code: 'custom', path, message });
}

export function gradeForScore(score: number) {
  if (score >= 90) return 'S';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

export type ResultReviewOutput = z.infer<typeof ResultReviewOutputSchema>;

const text = (maximum: number) => ({ type: 'string', minLength: 1, maxLength: maximum } as const);
const nullableText = (maximum: number) => ({ type: ['string', 'null'], maxLength: maximum } as const);

export const resultReviewJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'dataSufficiency',
    'sufficiencyReasons',
    'dataScore',
    'dataGrade',
    'isBusinessEffectiveRecommendation',
    'resultSummary',
    'performanceProblems',
    'attributionAnalysis',
    'optimizationSuggestions',
    'continueTestRecommendation',
  ],
  properties: {
    dataSufficiency: { type: 'string', enum: ['sufficient', 'insufficient'] },
    sufficiencyReasons: {
      type: 'array', maxItems: 10,
      items: {
        type: 'object', additionalProperties: false,
        required: ['code', 'description', 'requiredNextData'],
        properties: {
          code: {
            type: 'string',
            enum: ['missing_core_metric', 'sample_too_small', 'period_too_short', 'missing_benchmark', 'inconsistent_data', 'other'],
          },
          description: text(1000),
          requiredNextData: { type: 'array', maxItems: 8, items: text(500) },
        },
      },
    },
    dataScore: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
    dataGrade: { type: ['string', 'null'], enum: ['S', 'A', 'B', 'C', 'D', null] },
    isBusinessEffectiveRecommendation: { type: ['boolean', 'null'] },
    resultSummary: text(2000),
    performanceProblems: {
      type: 'array', maxItems: 10,
      items: {
        type: 'object', additionalProperties: false,
        required: ['metric', 'severity', 'observedValue', 'benchmarkValue', 'description'],
        properties: {
          metric: text(100),
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          observedValue: nullableText(200),
          benchmarkValue: nullableText(200),
          description: text(1000),
        },
      },
    },
    attributionAnalysis: {
      type: 'array', maxItems: 9,
      items: {
        type: 'object', additionalProperties: false,
        required: ['type', 'confidence', 'evidence', 'conclusion'],
        properties: {
          type: { type: 'string', enum: ['content', 'delivery', 'audience', 'price', 'product_page', 'live_room', 'activity', 'sample_size', 'external'] },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
          evidence: { type: 'array', maxItems: 8, items: text(500) },
          conclusion: text(1000),
        },
      },
    },
    optimizationSuggestions: {
      type: 'array', maxItems: 10,
      items: {
        type: 'object', additionalProperties: false,
        required: ['priority', 'owner', 'action', 'rationale'],
        properties: {
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          owner: { type: 'string', enum: ['content', 'delivery', 'operation', 'product', 'live_room', 'cross_function'] },
          action: text(1000),
          rationale: text(1000),
        },
      },
    },
    continueTestRecommendation: {
      type: 'string',
      enum: ['continue', 'optimize_then_continue', 'pause', 'collect_more_data'],
    },
  },
} as const;

export function validateResultReviewOutput(value: unknown): ResultReviewOutput {
  const result = ResultReviewOutputSchema.safeParse(value);
  if (!result.success) {
    throw new ResultReviewOutputValidationError('GPT result review output failed validation.');
  }
  return result.data;
}
