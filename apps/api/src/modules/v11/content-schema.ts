import { z } from 'zod';
import { V11_CONTENT_DIMENSIONS } from './content-scoring';
import { isV11FactClaimKey, V11_FACT_CLAIMS } from './fact-claims';

const dimensionCodes = V11_CONTENT_DIMENSIONS.map((item) => item.code) as [
  (typeof V11_CONTENT_DIMENSIONS)[number]['code'],
  ...(typeof V11_CONTENT_DIMENSIONS)[number]['code'][],
];

const evidenceSchema = z.object({
  startSeconds: z.number().finite().min(0).nullable(),
  endSeconds: z.number().finite().min(0).nullable(),
  reference: z.string().trim().min(1).max(100).nullable(),
  description: z.string().trim().min(1).max(1000),
}).strict().superRefine((value, context) => {
  if (value.startSeconds !== null && value.endSeconds !== null && value.endSeconds < value.startSeconds) {
    context.addIssue({ code: 'custom', message: 'Evidence end must not precede start.', path: ['endSeconds'] });
  }
});

const factClaimSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,79}$/),
  state: z.enum(['present', 'absent', 'uncertain']),
  evidenceReferences: z.array(z.string().trim().min(1).max(100)).max(20),
}).strict();

const observedDimensionSchema = z.object({
  dimension: z.enum(dimensionCodes),
  observationStatus: z.literal('observed'),
  anchor: z.number().int().min(0).max(4),
  facts: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  factClaims: z.array(factClaimSchema).min(1).max(20),
  evidence: z.array(evidenceSchema).min(1).max(20),
  observation: z.string().trim().min(1).max(1500),
}).strict();

const unknownDimensionSchema = z.object({
  dimension: z.enum(dimensionCodes),
  observationStatus: z.literal('unknown'),
  anchor: z.null(),
  facts: z.array(z.string().trim().min(1).max(500)).max(20),
  factClaims: z.array(factClaimSchema).max(20),
  evidence: z.array(evidenceSchema).max(20),
  observation: z.string().trim().min(1).max(1500),
}).strict();

export const V11ContentModelOutputSchema = z.object({
  dimensions: z.array(z.discriminatedUnion('observationStatus', [
    observedDimensionSchema,
    unknownDimensionSchema,
  ])).length(V11_CONTENT_DIMENSIONS.length),
  compliance: z.object({
    status: z.enum(['clear', 'suspected', 'confirmed']),
    facts: z.array(z.string().trim().min(1).max(500)).max(20),
  }).strict(),
}).strict().superRefine((value, context) => {
  const received = new Set(value.dimensions.map((item) => item.dimension));
  if (received.size !== V11_CONTENT_DIMENSIONS.length) {
    context.addIssue({ code: 'custom', message: 'Every dimension must appear exactly once.', path: ['dimensions'] });
  }
  value.dimensions.forEach((dimension, dimensionIndex) => {
    const seen = new Set<string>();
    dimension.factClaims.forEach((claim, claimIndex) => {
      if (!isV11FactClaimKey(dimension.dimension, claim.key)) {
        context.addIssue({
          code: 'custom',
          message: `Fact key is not allowed for ${dimension.dimension}.`,
          path: ['dimensions', dimensionIndex, 'factClaims', claimIndex, 'key'],
        });
      }
      if (seen.has(claim.key)) {
        context.addIssue({
          code: 'custom',
          message: `Fact key must be unique within ${dimension.dimension}.`,
          path: ['dimensions', dimensionIndex, 'factClaims', claimIndex, 'key'],
        });
      }
      seen.add(claim.key);
    });
  });
});

export type V11ContentModelOutput = z.infer<typeof V11ContentModelOutputSchema>;

export function assertEvidenceWithinDuration(output: V11ContentModelOutput, durationSeconds: number | null) {
  if (durationSeconds === null) return;
  for (const dimension of output.dimensions) {
    for (const evidence of dimension.evidence) {
      if ((evidence.startSeconds !== null && evidence.startSeconds > durationSeconds)
        || (evidence.endSeconds !== null && evidence.endSeconds > durationSeconds)) {
        throw new Error('Model evidence timestamp exceeds the frozen media duration.');
      }
    }
  }
}

const evidenceJsonSchema = {
  type: 'object',
  required: ['startSeconds', 'endSeconds', 'reference', 'description'],
  properties: {
    startSeconds: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }] },
    endSeconds: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }] },
    reference: { anyOf: [{ type: 'string', minLength: 1, maxLength: 100 }, { type: 'null' }] },
    description: { type: 'string', minLength: 1, maxLength: 1000 },
  },
  additionalProperties: false,
} as const;

function factClaimJsonSchema(dimension: (typeof V11_CONTENT_DIMENSIONS)[number]['code']) {
  return {
    type: 'object',
    required: ['key', 'state', 'evidenceReferences'],
    properties: {
      key: { type: 'string', enum: V11_FACT_CLAIMS[dimension] },
      state: { type: 'string', enum: ['present', 'absent', 'uncertain'] },
      evidenceReferences: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 100 } },
    },
    additionalProperties: false,
  } as const;
}

const dimensionJsonSchemas = V11_CONTENT_DIMENSIONS.map(({ code }) => ({
  type: 'object',
  required: ['dimension', 'observationStatus', 'anchor', 'facts', 'factClaims', 'evidence', 'observation'],
  properties: {
    dimension: { type: 'string', const: code },
    observationStatus: { type: 'string', enum: ['observed', 'unknown'] },
    anchor: { anyOf: [{ type: 'integer', minimum: 0, maximum: 4 }, { type: 'null' }] },
    facts: { type: 'array', items: { type: 'string' } },
    factClaims: { type: 'array', maxItems: 20, items: factClaimJsonSchema(code) },
    evidence: { type: 'array', items: evidenceJsonSchema },
    observation: { type: 'string' },
  },
  additionalProperties: false,
}));

export const v11ContentResponseJsonSchema = {
  type: 'object',
  required: ['dimensions', 'compliance'],
  properties: {
    dimensions: {
      type: 'array',
      minItems: V11_CONTENT_DIMENSIONS.length,
      maxItems: V11_CONTENT_DIMENSIONS.length,
      items: { oneOf: dimensionJsonSchemas },
    },
    compliance: {
      type: 'object',
      required: ['status', 'facts'],
      properties: {
        status: { type: 'string', enum: ['clear', 'suspected', 'confirmed'] },
        facts: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;
