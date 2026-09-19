import { z } from 'zod';
import { ContentReviewOutputValidationError } from './gemini.errors';
import { contentDimensionCodes } from './content-scoring';

const severitySchema = z.enum(['high', 'medium', 'low']);

const scoreItemSchema = z.object({
  dimension: z.enum(contentDimensionCodes),
  rating: z.number().int().min(0).max(5),
  evidence: z.string().min(1).max(1000),
  timestamp: z.string().max(30).nullable(),
}).strict();

export const ContentReviewOutputSchema = z.object({
  contentSummary: z.string(),
  isPublishableRecommendation: z.boolean(),
  mainProblems: z.array(z.object({
    dimension: z.string().min(1),
    description: z.string(),
    timestamp: z.string().nullable(),
    severity: severitySchema,
  }).strict()),
  revisionSuggestions: z.array(z.object({
    problem: z.string(),
    suggestion: z.string(),
    priority: severitySchema,
  }).strict()),
  complianceRisks: z.array(z.object({
    riskType: z.string(),
    description: z.string(),
    timestamp: z.string().nullable(),
    severity: severitySchema,
  }).strict()),
  usableScenarios: z.array(z.string()),
  scores: z.array(scoreItemSchema).length(contentDimensionCodes.length),
}).strict().superRefine((value, context) => {
  const uniqueDimensions = new Set(value.scores.map((score) => score.dimension));
  if (uniqueDimensions.size !== contentDimensionCodes.length) {
    context.addIssue({
      code: 'custom',
      message: 'scores must contain every content dimension exactly once',
      path: ['scores'],
    });
  }
});

export type ContentReviewOutput = z.infer<typeof ContentReviewOutputSchema>;

const stringSchema = { type: 'string' } as const;
const nullableTimestampSchema = {
  anyOf: [{ type: 'string' }, { type: 'null' }],
} as const;

export const contentReviewResponseJsonSchema = {
  type: 'object',
  required: [
    'contentSummary',
    'isPublishableRecommendation',
    'mainProblems',
    'revisionSuggestions',
    'complianceRisks',
    'usableScenarios',
    'scores',
  ],
  properties: {
    contentSummary: stringSchema,
    isPublishableRecommendation: { type: 'boolean' },
    mainProblems: {
      type: 'array',
      items: {
        type: 'object',
        required: ['dimension', 'description', 'timestamp', 'severity'],
        properties: {
          dimension: stringSchema,
          description: stringSchema,
          timestamp: nullableTimestampSchema,
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        additionalProperties: false,
      },
    },
    revisionSuggestions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['problem', 'suggestion', 'priority'],
        properties: {
          problem: stringSchema,
          suggestion: stringSchema,
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        additionalProperties: false,
      },
    },
    complianceRisks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['riskType', 'description', 'timestamp', 'severity'],
        properties: {
          riskType: stringSchema,
          description: stringSchema,
          timestamp: nullableTimestampSchema,
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        additionalProperties: false,
      },
    },
    usableScenarios: { type: 'array', items: stringSchema },
    scores: {
      type: 'array',
      minItems: contentDimensionCodes.length,
      maxItems: contentDimensionCodes.length,
      items: {
        type: 'object',
        required: ['dimension', 'rating', 'evidence', 'timestamp'],
        properties: {
          dimension: { type: 'string', enum: contentDimensionCodes },
          rating: { type: 'integer', minimum: 0, maximum: 5 },
          evidence: { type: 'string', minLength: 1, maxLength: 1000 },
          timestamp: nullableTimestampSchema,
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const;

export function validateContentReviewOutput(value: unknown): ContentReviewOutput {
  const result = ContentReviewOutputSchema.safeParse(value);
  if (!result.success) {
    throw new ContentReviewOutputValidationError('Video content review output failed schema validation.');
  }
  return result.data;
}
