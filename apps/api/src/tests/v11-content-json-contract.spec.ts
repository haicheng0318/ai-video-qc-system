import assert from 'node:assert/strict';
import { test } from 'node:test';
import { V11_FACT_CLAIMS } from '../modules/v11/fact-claims';
import { buildV11ContentPrompt } from '../modules/v11/content-prompt';
import { V11ContentModelOutputSchema, v11ContentResponseJsonSchema } from '../modules/v11/content-schema';
import { calculateV11ContentScore, V11_CONTENT_DIMENSIONS } from '../modules/v11/content-scoring';
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
      factClaims: [{
        key: V11_FACT_CLAIMS[code][0],
        state: 'present' as const,
        evidenceReferences: ['00:00-00:01'],
      }],
      evidence: [{
        startSeconds: 0,
        endSeconds: 1,
        reference: '00:00-00:01',
        description: `${code} evidence`,
      }],
      observation: `${code} observation`,
    })),
    compliance: { status: 'clear' as const, facts: [] },
  };
}

test('V1.1 prompt embeds the canonical JSON contract and explicit root rules', () => {
  const prompt = buildV11ContentPrompt(
    { platform: 'douyin' },
    v11ContentResponseJsonSchema,
  );

  assert.match(prompt, /只返回一个 JSON 对象/);
  assert.match(prompt, /不得返回 Markdown、代码块或解释文字/);
  assert.match(prompt, /根对象必须且只能包含[\s\S]*dimensions[\s\S]*compliance/);
  assert.ok(prompt.includes(JSON.stringify(v11ContentResponseJsonSchema)));
  for (const { code } of V11_CONTENT_DIMENSIONS) assert.match(prompt, new RegExp(`\\b${code}\\b`));
  for (const keys of Object.values(V11_FACT_CLAIMS)) {
    for (const key of keys) assert.match(prompt, new RegExp(`\\b${key}\\b`));
  }
});

test('legacy flat smoke response remains rejected by the strict V1.1 schema', () => {
  const legacySmokeOutput = {
    opening_hook: { anchor: 3 },
    selling_point: { anchor: 3 },
    summary: 'legacy flat output',
  };
  assert.equal(V11ContentModelOutputSchema.safeParse(legacySmokeOutput).success, false);
});

test('complete JSON parses, validates, and reaches deterministic backend scoring', () => {
  const parsedJson = JSON.parse(JSON.stringify(validOutput()));
  const validated = V11ContentModelOutputSchema.parse(parsedJson);
  const scored = calculateV11ContentScore(validated);
  assert.equal(validated.dimensions.length, 8);
  assert.equal(scored.totalScore, 75);
  assert.equal(scored.contentRating, 'B');
});

test('strict schema rejects missing dimensions or compliance', () => {
  const valid = validOutput();
  const { dimensions: _dimensions, ...withoutDimensions } = valid;
  const { compliance: _compliance, ...withoutCompliance } = valid;
  assert.equal(V11ContentModelOutputSchema.safeParse(withoutDimensions).success, false);
  assert.equal(V11ContentModelOutputSchema.safeParse(withoutCompliance).success, false);
});

test('strict schema rejects illegal fact keys and anchors', () => {
  const illegalFact = validOutput();
  (illegalFact.dimensions[0].factClaims[0] as { key: string }).key = 'invented_smoke_fact';
  assert.equal(V11ContentModelOutputSchema.safeParse(illegalFact).success, false);

  const illegalAnchor = validOutput();
  illegalAnchor.dimensions[0].anchor = 5;
  assert.equal(V11ContentModelOutputSchema.safeParse(illegalAnchor).success, false);
});

test('JSON contract prompt version changes the evaluation fingerprint', () => {
  assert.equal(V11_PROMPT_VERSION, 'content-review-v1.1-json-contract-v3');
  const base = {
    ownerId: 'smoke-owner',
    fileHash: 'file-hash',
    metadataSnapshotHash: 'metadata-hash',
    mediaManifestHash: 'manifest-hash',
    modelConfigSnapshot: { modelName: 'qwen3.5-omni-plus' },
    schemaVersion: V11_SCHEMA_VERSION,
    rubricVersion: V11_RUBRIC_VERSION,
    ratingVersion: 'content-rating-v1.1',
    preprocessingVersion: 'media-preprocess-v1.1',
    referenceSetVersion: 'reference-set-v1.1',
  };
  const previous = buildEvaluationFingerprint({
    ...base,
    promptVersion: 'content-review-v1.1-fact-claims-v2',
  });
  const current = buildEvaluationFingerprint({ ...base, promptVersion: V11_PROMPT_VERSION });
  assert.notEqual(current, previous);
});
