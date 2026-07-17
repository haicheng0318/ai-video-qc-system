import { z } from 'zod';
import { GeminiOutputValidationError } from './gemini.errors';

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

const stringSchema = { type: 'STRING' } as const;
const nullableTimestampSchema = { type: 'STRING', nullable: true } as const;

export const geminiResponseJsonSchema = {
  type: 'OBJECT',
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
    totalScore: { type: 'INTEGER', minimum: 0, maximum: 100 },
    contentGrade: { type: 'STRING', enum: ['S', 'A', 'B', 'C', 'D'] },
    isPublishableRecommendation: { type: 'BOOLEAN' },
    mainProblems: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['dimension', 'description', 'timestamp', 'severity'],
        properties: {
          dimension: stringSchema,
          description: stringSchema,
          timestamp: nullableTimestampSchema,
          severity: { type: 'STRING', enum: ['high', 'medium', 'low'] },
        },
        additionalProperties: false,
      },
    },
    revisionSuggestions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['problem', 'suggestion', 'priority'],
        properties: {
          problem: stringSchema,
          suggestion: stringSchema,
          priority: { type: 'STRING', enum: ['high', 'medium', 'low'] },
        },
        additionalProperties: false,
      },
    },
    complianceRisks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['riskType', 'description', 'timestamp'],
        properties: {
          riskType: stringSchema,
          description: stringSchema,
          timestamp: nullableTimestampSchema,
        },
        additionalProperties: false,
      },
    },
    usableScenarios: { type: 'ARRAY', items: stringSchema },
    scores: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['dimension', 'score', 'maxScore', 'comment'],
        properties: {
          dimension: stringSchema,
          score: { type: 'INTEGER', minimum: 0 },
          maxScore: { type: 'INTEGER', minimum: 1 },
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
    throw new GeminiOutputValidationError('Gemini content review output failed schema validation.');
  }
  return result.data;
}
