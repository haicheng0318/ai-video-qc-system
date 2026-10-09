import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalize, sha256, sha256File, V11MediaManifest, V11_PREPROCESSING_VERSION } from './provenance';

const executeFile = promisify(execFile);

type Probe = {
  streams?: Array<Record<string, unknown>>;
  format?: { duration?: string };
};

function fraction(value: unknown) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/.test(value)) return null;
  const [left, right] = value.split('/').map(Number);
  return right > 0 ? left / right : null;
}

function samples(duration: number | null) {
  if (!duration || duration <= 0) return [];
  const count = Math.min(12, Math.max(3, Math.ceil(duration / 5)));
  return Array.from({ length: count }, (_, index) => Math.round(duration * index / Math.max(1, count - 1) * 1000) / 1000);
}

export function mediaManifestCompleteness(manifest: V11MediaManifest, probeAvailable: boolean) {
  const incompleteReasons: string[] = [];
  if (!probeAvailable) incompleteReasons.push('media_probe_unavailable');
  if (manifest.durationSeconds === null) incompleteReasons.push('duration_unavailable');
  if (manifest.fps === null) incompleteReasons.push('fps_unavailable');
  if (manifest.width === null || manifest.height === null) incompleteReasons.push('resolution_unavailable');
  if (manifest.hasAudio === null) incompleteReasons.push('audio_presence_unavailable');
  return { inputComplete: incompleteReasons.length === 0, incompleteReasons };
}

export async function createMediaManifest(path: string, fallback: { sizeBytes: bigint; durationSeconds?: number | null }) {
  const fileHash = await sha256File(path);
  let probe: Probe = {};
  let probeAvailable = true;
  try {
    const result = await executeFile('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate,nb_frames',
      '-of', 'json', path,
    ], { timeout: 30_000, maxBuffer: 1_000_000 });
    probe = JSON.parse(result.stdout) as Probe;
  } catch {
    probeAvailable = false;
  }
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams?.find((stream) => stream.codec_type === 'audio');
  const parsedDuration = Number(probe.format?.duration);
  const durationSeconds = Number.isFinite(parsedDuration) && parsedDuration >= 0
    ? Math.round(parsedDuration * 1000) / 1000
    : fallback.durationSeconds ?? null;
  const sampleTimestamps = samples(durationSeconds);
  const manifest: V11MediaManifest = {
    fileHash,
    sizeBytes: fallback.sizeBytes.toString(),
    durationSeconds,
    fps: fraction(video?.r_frame_rate),
    width: Number.isInteger(video?.width) ? Number(video?.width) : null,
    height: Number.isInteger(video?.height) ? Number(video?.height) : null,
    hasAudio: probeAvailable ? Boolean(audio) : null,
    preprocessingVersion: V11_PREPROCESSING_VERSION,
    sampleTimestamps,
    frameCount: /^\d+$/.test(String(video?.nb_frames || '')) ? Number(video?.nb_frames) : null,
    segmentBoundaries: durationSeconds === null ? [] : [{ start: 0, end: durationSeconds }],
    mediaInputId: 'full-video-v1',
    mediaInputHash: sha256(canonicalize({ fileHash, mode: 'full-video', sampleTimestamps })),
    transcriptionVersion: null,
    transcriptionHash: null,
  };
  const completeness = mediaManifestCompleteness(manifest, probeAvailable);
  return {
    manifest,
    manifestHash: sha256(canonicalize(manifest)),
    ...completeness,
  };
}
