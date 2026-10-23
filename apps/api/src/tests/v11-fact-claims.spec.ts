import assert from 'node:assert/strict';
import { test } from 'node:test';
import { V11_FACT_CLAIM_DEFINITIONS, V11_FACT_CLAIM_VERSION, V11_FACT_CLAIMS } from '../modules/v11/fact-claims';
import { buildV11ContentPrompt } from '../modules/v11/content-prompt';
import { V11ContentModelOutputSchema, v11ContentResponseJsonSchema } from '../modules/v11/content-schema';
import { V11_CONTENT_DIMENSIONS } from '../modules/v11/content-scoring';
import {
  buildEvaluationFingerprint,
  V11_PROMPT_VERSION,
  V11_RUBRIC_VERSION,
  V11_SCHEMA_VERSION,
} from '../modules/v11/provenance';

function validOutput() {
  return {
    dimensions: V11_CONTENT_DIMENSIONS.map(({ code }) => ({
      dimension: code,
      observationStatus: 'observed' as const,
      anchor: 3,
      facts: [`${code} observed`],
      factClaims: [{ key: V11_FACT_CLAIMS[code][0], state: 'present' as const, evidenceReferences: ['00:00-00:01'] }],
      evidence: [{ startSeconds: 0, endSeconds: 1, reference: '00:00-00:01', description: `${code} evidence` }],
      observation: `${code} observation`,
      improvementSuggestions: [],
    })),
    compliance: { status: 'clear' as const, facts: [] },
  };
}

test('canonical fact vocabulary is versioned and dimension-scoped across schema and prompt', () => {
  assert.equal(V11_FACT_CLAIM_VERSION, 'fact-claims-v1.1-v3');
  assert.deepEqual(Object.keys(V11_FACT_CLAIMS), V11_CONTENT_DIMENSIONS.map(({ code }) => code));

  const prompt = buildV11ContentPrompt({ platform: 'douyin' }, v11ContentResponseJsonSchema);
  for (const [dimension, keys] of Object.entries(V11_FACT_CLAIMS)) {
    assert.match(prompt, new RegExp(`- ${dimension}（`));
    for (const key of keys) assert.match(prompt, new RegExp(`\\b${key}\\b`));
  }

  const dimensionSchemas = (v11ContentResponseJsonSchema.properties.dimensions.items as { oneOf: unknown[] }).oneOf;
  assert.equal(dimensionSchemas.length, V11_CONTENT_DIMENSIONS.length);
});

test('action cue has a frozen observable definition and excludes implicit purchase motivation', () => {
  assert.match(V11_FACT_CLAIM_DEFINITIONS.action_logic.action_cue_present, /明确可观察/);
  const prompt = buildV11ContentPrompt({ platform: 'douyin' }, v11ContentResponseJsonSchema);
  assert.match(prompt, /action_cue_present/);
  assert.match(prompt, /明确可观察的行动提示/);
  assert.match(prompt, /产品吸引力、购买动机或使用场景本身不算行动提示/);
});

test('content schema rejects free-form fact keys', () => {
  const output = validOutput();
  (output.dimensions[0].factClaims[0] as { key: string }).key = 'model_invented_fact_key';
  assert.equal(V11ContentModelOutputSchema.safeParse(output).success, false);
});

test('content schema rejects duplicate canonical keys within one dimension', () => {
  const output = validOutput();
  output.dimensions[0].factClaims.push({ ...output.dimensions[0].factClaims[0] });
  assert.equal(V11ContentModelOutputSchema.safeParse(output).success, false);
});

test('fact vocabulary version upgrades prompt schema and rubric fingerprint inputs', () => {
  assert.notEqual(V11_PROMPT_VERSION, 'content-review-v1.1');
  assert.notEqual(V11_SCHEMA_VERSION, 'content-review-schema-v1.1');
  assert.notEqual(V11_RUBRIC_VERSION, 'content-rubric-v1.1');

  const base = {
    ownerId: 'owner',
    fileHash: 'file',
    metadataSnapshotHash: 'metadata',
    mediaManifestHash: 'manifest',
    modelConfigSnapshot: { modelName: 'qwen' },
    promptVersion: 'content-review-v1.1',
    schemaVersion: 'content-review-schema-v1.1',
    rubricVersion: 'content-rubric-v1.1',
    ratingVersion: 'content-rating-v1.1',
    preprocessingVersion: 'media-preprocess-v1.1',
    referenceSetVersion: 'reference-set-v1.1',
  };
  const legacy = buildEvaluationFingerprint(base);
  const current = buildEvaluationFingerprint({
    ...base,
    promptVersion: V11_PROMPT_VERSION,
    schemaVersion: V11_SCHEMA_VERSION,
    rubricVersion: V11_RUBRIC_VERSION,
  });
  assert.notEqual(current, legacy);

  const previousV2 = buildEvaluationFingerprint({
    ...base,
    promptVersion: 'content-review-v1.1-json-contract-v3',
    schemaVersion: V11_SCHEMA_VERSION,
    rubricVersion: 'content-rubric-v1.1-fact-claims-v2',
  });
  assert.notEqual(current, previousV2);
});
