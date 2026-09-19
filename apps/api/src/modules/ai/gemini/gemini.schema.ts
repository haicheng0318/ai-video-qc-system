import { z } from 'zod';
import { ContentReviewOutputValidationError } from './gemini.errors';

const gradeSchema = z.enum(['S', 'A', 'B', 'C', 'D']);
const severitySchema = z.enum(['high', 'medium', 'low']);

const scoreItemSchema = z.object({
  dimension: z.string().min(1),
  score: z.number().int().min(0),
  maxScore: z.number().int().positive(),
  comment: z.string(),
}).strict().refine((item) => item.score <= item.maxScore, {
  message: 'score must not exceed maxScore',
  path: ['score'],
});

export const ContentReviewOutputSchema = z.object({
  contentSummary: z.string(),
  totalScore: z.number().int().min(0).max(100),
  contentGrade: gradeSchema,
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
  }).strict()),
  usableScenarios: z.array(z.string()),
  scores: z.array(scoreItemSchema),
}).strict().superRefine((value, context) => {
  const expectedGrade = value.totalScore >= 90
    ? 'S'
    : value.totalScore >= 80
      ? 'A'
      : value.totalScore >= 70
        ? 'B'
        : value.totalScore >= 60
          ? 'C'
          : 'D';

  if (value.contentGrade !== expectedGrade) {
    context.addIssue({
      code: 'custom',
      message: `contentGrade must match totalScore band ${expectedGrade}`,
      path: ['contentGrade'],
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
    'totalScore',
    'contentGrade',
    'isPublishableRecommendation',
    'mainProblems',
    'revisionSuggestions',
    'complianceRisks',
    'usableScenarios',
    'scores',
  ],
  properties: {
    contentSummary: stringSchema,
    totalScore: { type: 'integer', minimum: 0, maximum: 100 },
    contentGrade: { type: 'string', enum: ['S', 'A', 'B', 'C', 'D'] },
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
        required: ['riskType', 'description', 'timestamp'],
        properties: {
          riskType: stringSchema,
          description: stringSchema,
          timestamp: nullableTimestampSchema,
        },
        additionalProperties: false,
      },
    },
    usableScenarios: { type: 'array', items: stringSchema },
    scores: {
      type: 'array',
      items: {
        type: 'object',
        required: ['dimension', 'score', 'maxScore', 'comment'],
        properties: {
          dimension: stringSchema,
          score: { type: 'integer', minimum: 0 },
          maxScore: { type: 'integer', minimum: 1 },
          comment: stringSchema,
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
