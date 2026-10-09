import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildEvaluationFingerprint, canonicalize, sha256 } from '../modules/v11/provenance';
import { mediaManifestCompleteness } from '../modules/v11/media-manifest';

const base = {
  ownerId: 'owner-a',
  fileHash: 'a'.repeat(64),
  metadataSnapshotHash: 'b'.repeat(64),
  mediaManifestHash: 'c'.repeat(64),
  modelConfigSnapshot: { model: 'qwen', temperature: 0 },
  promptVersion: 'prompt-v1',
  schemaVersion: 'schema-v1',
  rubricVersion: 'rubric-v1',
  ratingVersion: 'rating-v1',
  preprocessingVersion: 'pre-v1',
  referenceSetVersion: 'ref-v1',
};

test('canonical hashes are deterministic regardless of object key order', () => {
  assert.equal(canonicalize({ b: 2, a: 1 }), canonicalize({ a: 1, b: 2 }));
  assert.equal(sha256(canonicalize({ b: 2, a: 1 })), sha256(canonicalize({ a: 1, b: 2 })));
});

test('evaluation fingerprint is deterministic for frozen inputs', () => {
  assert.equal(buildEvaluationFingerprint(base), buildEvaluationFingerprint({ ...base }));
});

test('evaluation fingerprint is version sensitive', () => {
  assert.notEqual(buildEvaluationFingerprint(base), buildEvaluationFingerprint({ ...base, rubricVersion: 'rubric-v2' }));
});

test('evaluation fingerprint is owner scoped', () => {
  assert.notEqual(buildEvaluationFingerprint(base), buildEvaluationFingerprint({ ...base, ownerId: 'owner-b' }));
});

test('media manifest records each missing technical input instead of only marking incomplete', () => {
  const result = mediaManifestCompleteness({
    fileHash: 'a'.repeat(64), sizeBytes: '1', durationSeconds: null, fps: null, width: null, height: null,
    hasAudio: null, preprocessingVersion: 'pre-v1', sampleTimestamps: [], frameCount: null,
    segmentBoundaries: [], mediaInputId: 'full-video-v1', mediaInputHash: 'b'.repeat(64),
    transcriptionVersion: null, transcriptionHash: null,
  }, true);
  assert.equal(result.inputComplete, false);
  assert.deepEqual(result.incompleteReasons, [
    'duration_unavailable', 'fps_unavailable', 'resolution_unavailable', 'audio_presence_unavailable',
  ]);
});
