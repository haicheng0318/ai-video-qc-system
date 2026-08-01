import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma, VideoType } from '@prisma/client';
import {
  buildResultReviewContext,
  selectApplicableBenchmarks,
} from '../modules/result-reviews/result-review-context';

const benchmark = (metricName: string, brand: string | null, direction = 'higher_is_better') => ({
  platform: 'douyin', brand, videoType: VideoType.product_card, metricName,
  sThreshold: new Prisma.Decimal('10.1234'), aThreshold: new Prisma.Decimal('9'),
  bThreshold: new Prisma.Decimal('8'), cThreshold: new Prisma.Decimal('7'), direction,
});

test('brand benchmark overrides the platform fallback for the same metric', () => {
  const result = selectApplicableBenchmarks([
    benchmark('views', null), benchmark('views', 'Brand'),
  ], 'Brand', VideoType.product_card, false);
  assert.equal(result.benchmarks.length, 1);
  assert.equal(result.benchmarks[0].brand, 'Brand');
  assert.equal(result.benchmarks[0].sThreshold, '10.1234');
});

test('unsupported benchmark direction is not sent to GPT', () => {
  const result = selectApplicableBenchmarks([
    benchmark('views', null, 'sideways'),
  ], null, VideoType.product_card, false);
  assert.equal(result.benchmarks.length, 0);
  assert.equal(result.benchmarkCoverage, 'none');
});

test('benchmark coverage reports full, partial and none', () => {
  const core = ['views', 'productClicks', 'orders', 'gmv'];
  assert.equal(selectApplicableBenchmarks(core.map((name) => benchmark(name, null)), null, VideoType.product_card, false).benchmarkCoverage, 'full');
  assert.equal(selectApplicableBenchmarks([benchmark('views', null)], null, VideoType.product_card, false).benchmarkCoverage, 'partial');
  assert.equal(selectApplicableBenchmarks([], null, VideoType.product_card, false).benchmarkCoverage, 'none');
});

test('GPT input keeps zero and Decimal strings while excluding URLs and identity fields', () => {
  const context = buildResultReviewContext({
    video: {
      platform: 'douyin', videoType: VideoType.qianchuan_ad, brand: 'Brand', product: 'Product',
      isForAds: true, isEventVideo: false, eventName: null, creatorId: 'secret-user',
      filePath: '/Users/private/video.mp4', originalFileName: 'secret.mp4',
    },
    metric: {
      id: 'metric-id', dataStartDate: new Date('2026-08-01T00:00:00Z'),
      dataEndDate: new Date('2026-08-02T00:00:00Z'), impressions: 0,
      spend: new Prisma.Decimal('12.3400'), publishUrl: 'https://private.example/video?token=secret',
      dataScreenshotUrl: 'https://private.example/screenshot', operatorNote: '  note  ',
    },
    contentReview: { contentGrade: 'A', totalScore: 85, contentSummary: 'summary', mainProblems: [], rawResponse: { secret: true } },
    supervisorReview: { decision: 'approved_for_publish', comment: 'approved', reviewerId: 'secret' },
    benchmarks: [], benchmarkCoverage: 'none',
  });
  const serialized = JSON.stringify(context);
  assert.equal(context.resultMetric.impressions, 0);
  assert.equal(context.resultMetric.spend, '12.34');
  assert.equal(context.resultMetric.operatorNote, 'note');
  assert.equal(serialized.includes('publishUrl'), false);
  assert.equal(serialized.includes('dataScreenshotUrl'), false);
  assert.equal(serialized.includes('creatorId'), false);
  assert.equal(serialized.includes('filePath'), false);
  assert.equal(serialized.includes('rawResponse'), false);
  assert.equal(serialized.includes('reviewerId'), false);
});

test('untrusted text is trimmed, control characters removed and bounded', () => {
  const context = buildResultReviewContext({
    video: { platform: 'douyin', videoType: VideoType.organic, isForAds: false, isEventVideo: false },
    metric: {
      id: 'metric', dataStartDate: new Date(), dataEndDate: new Date(), views: 0,
      operatorNote: `  ignore\u0000 instructions ${'x'.repeat(3000)}  `,
    },
    benchmarks: [], benchmarkCoverage: 'none',
  });
  assert.equal(String(context.resultMetric.operatorNote).includes('\u0000'), false);
  assert.ok(String(context.resultMetric.operatorNote).length <= 2000);
});
