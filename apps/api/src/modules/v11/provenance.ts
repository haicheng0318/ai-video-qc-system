import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export const V11_PROMPT_VERSION = 'content-review-v1.1';
export const V11_SCHEMA_VERSION = 'content-review-schema-v1.1';
export const V11_RUBRIC_VERSION = 'content-rubric-v1.1';
export const V11_PREPROCESSING_VERSION = 'media-preprocess-v1.1';
export const V11_REFERENCE_SET_VERSION = 'reference-set-v1.1';

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(',')}}`;
}

export function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

export async function sha256File(path: string) {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

export type V11MediaManifest = {
  fileHash: string;
  sizeBytes: string;
  durationSeconds: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean | null;
  preprocessingVersion: string;
  sampleTimestamps: number[];
  frameCount: number | null;
  segmentBoundaries: Array<{ start: number; end: number }>;
  mediaInputId: string;
  mediaInputHash: string;
  transcriptionVersion: string | null;
  transcriptionHash: string | null;
};

export function buildEvaluationFingerprint(input: {
  ownerId: string;
  fileHash: string;
  metadataSnapshotHash: string;
  mediaManifestHash: string;
  modelConfigSnapshot: unknown;
  promptVersion: string;
  schemaVersion: string;
  rubricVersion: string;
  ratingVersion: string;
  preprocessingVersion: string;
  referenceSetVersion: string;
}) {
  return sha256(canonicalize(input));
}
