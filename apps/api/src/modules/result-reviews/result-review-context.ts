import { Prisma, VideoType } from '@prisma/client';
import {
  getResultMetricFieldConfig,
  resultMetricDataFields,
  resultMetricFieldDefinitions,
  ResultMetricField,
} from '@ai-video-qc/shared';

export type BenchmarkCoverage = 'full' | 'partial' | 'none';
export type BenchmarkInput = {
  platform: string;
  brand: string | null;
  videoType: VideoType;
  metricName: string;
  sThreshold: Prisma.Decimal | null;
  aThreshold: Prisma.Decimal | null;
  bThreshold: Prisma.Decimal | null;
  cThreshold: Prisma.Decimal | null;
  direction: string;
};

const excludedMetricFields = new Set<ResultMetricField>([
  'publishUrl',
  'publishDate',
  'dataScreenshotUrl',
]);
const supportedDirections = new Set(['higher_is_better', 'lower_is_better']);

function cleanText(value: unknown, maximum = 2000) {
  if (typeof value !== 'string') return value ?? null;
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maximum) || null;
}

function cleanUntrustedJson(value: unknown, depth = 0): unknown {
  if (depth > 4) return null;
  if (typeof value === 'string') return cleanText(value, 1000);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 10).map((item) => cleanUntrustedJson(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .slice(0, 20)
      .map(([key, item]) => [key.slice(0, 100), cleanUntrustedJson(item, depth + 1)]));
  }
  return null;
}

function serializeMetricValue(field: ResultMetricField, value: unknown) {
  if (value === null || value === undefined) return null;
  const kind = resultMetricFieldDefinitions[field].kind;
  if (kind === 'date') return new Date(value as string | number | Date).toISOString();
  if (['money2', 'decimal4', 'percentage', 'roi'].includes(kind)) return String(value);
  if (kind === 'text') return cleanText(value);
  return value;
}

export function selectApplicableBenchmarks(
  benchmarks: BenchmarkInput[],
  brand: string | null,
  videoType: VideoType,
  isForAds: boolean,
) {
  const byMetric = new Map<string, BenchmarkInput>();
  let invalidDirectionCount = 0;
  for (const benchmark of benchmarks) {
    if (!supportedDirections.has(benchmark.direction)) {
      invalidDirectionCount += 1;
      continue;
    }
    const current = byMetric.get(benchmark.metricName);
    const exactBrand = Boolean(brand && benchmark.brand === brand);
    const currentExact = Boolean(brand && current?.brand === brand);
    if (!current || (exactBrand && !currentExact)) byMetric.set(benchmark.metricName, benchmark);
  }

  const selected = [...byMetric.values()].map((benchmark) => ({
    platform: benchmark.platform,
    brand: benchmark.brand,
    videoType: benchmark.videoType,
    metricName: benchmark.metricName,
    sThreshold: benchmark.sThreshold?.toString() ?? null,
    aThreshold: benchmark.aThreshold?.toString() ?? null,
    bThreshold: benchmark.bThreshold?.toString() ?? null,
    cThreshold: benchmark.cThreshold?.toString() ?? null,
    direction: benchmark.direction,
  }));
  const coreFields = getResultMetricFieldConfig(videoType, isForAds).coreFields;
  const coveredCore = coreFields.filter((field) => byMetric.has(field));
  const coverage: BenchmarkCoverage = coveredCore.length === 0
    ? 'none'
    : coveredCore.length === coreFields.length
      ? 'full'
      : 'partial';
  return { benchmarks: selected, benchmarkCoverage: coverage, invalidDirectionCount };
}

export function buildResultReviewContext(input: {
  video: Record<string, any>;
  metric: Record<string, any>;
  contentReview?: Record<string, any> | null;
  supervisorReview?: Record<string, any> | null;
  benchmarks: Array<Record<string, unknown>>;
  benchmarkCoverage: BenchmarkCoverage;
}) {
  const metricValues: Record<string, unknown> = {
    resultMetricId: input.metric.id,
  };
  for (const field of resultMetricDataFields) {
    if (excludedMetricFields.has(field)) continue;
    metricValues[field] = serializeMetricValue(field, input.metric[field]);
  }

  return {
    video: {
      platform: cleanText(input.video.platform, 100),
      videoType: input.video.videoType,
      brand: cleanText(input.video.brand, 100),
      product: cleanText(input.video.product, 100),
      isForAds: Boolean(input.video.isForAds),
      isEventVideo: Boolean(input.video.isEventVideo),
      eventName: cleanText(input.video.eventName, 100),
    },
    resultMetric: metricValues,
    contentReview: input.contentReview ? {
      contentGrade: input.contentReview.contentGrade,
      totalScore: input.contentReview.totalScore,
      contentSummary: cleanText(input.contentReview.contentSummary, 2000),
      mainProblems: Array.isArray(input.contentReview.mainProblems)
        ? cleanUntrustedJson(input.contentReview.mainProblems)
        : [],
    } : null,
    supervisorReview: input.supervisorReview ? {
      decision: input.supervisorReview.decision,
      comment: cleanText(input.supervisorReview.comment, 2000),
    } : null,
    benchmarks: input.benchmarks,
    benchmarkCoverage: input.benchmarkCoverage,
  };
}
