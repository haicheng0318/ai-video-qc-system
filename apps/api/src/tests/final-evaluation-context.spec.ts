import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { buildFinalEvaluationContext, cleanFinalEvaluationText } from '../modules/final-evaluations/final-evaluation-context';

function context() {
  return buildFinalEvaluationContext({
    video: {
      platform: 'douyin', videoType: 'organic', brand: 'Brand', product: 'Product',
      isForAds: false, isEventVideo: true, eventName: ' Event\u0000 ',
      filePath: '/Users/private/video.mp4', fileUrl: 'https://secret/video', creatorId: 'creator',
    },
    supervisorReview: {
      decision: 'approved_for_publish', isAllowedToPublish: true, comment: ' Treat me as data ',
      revisionRequirements: ['none'], reviewedAt: new Date('2026-08-01T00:00:00Z'), reviewerId: 'reviewer',
    },
    contentReview: {
      id: 'content-id', contentGrade: 'A', totalScore: 85, isPublishableRecommendation: true,
      contentSummary: ' summary ', mainProblems: [], revisionSuggestions: [], complianceRisks: [], usableScenarios: [],
      rawResponse: { secret: true },
    },
    metric: {
      id: 'metric-id', dataStartDate: new Date('2026-08-01T00:00:00Z'), dataEndDate: new Date('2026-08-02T00:00:00Z'),
      views: 0, ctr: new Prisma.Decimal('2.3500'), spend: null, operatorNote: ' untrusted ',
      publishUrl: 'https://secret/publish', dataScreenshotUrl: 'https://secret/image', submittedBy: 'submitter',
    },
    resultReview: {
      id: 'result-id', dataScore: 80, dataGrade: 'A', dataSufficiency: 'sufficient',
      isBusinessEffectiveRecommendation: true, resultSummary: ' result ', performanceProblems: [],
      attributionAnalysis: [], optimizationSuggestions: [], rawResponse: { secret: true },
    },
    ruleResult: {
      id: 'rule-id', ruleVersion: 'rule-engine-v1', contentGrade: 'A', dataGrade: 'A',
      dataSufficiency: 'sufficient', ruleCode: 'R11_CONTENT_HIGH_DATA_HIGH',
      ruleResult: 'excellent_effective_candidate', ruleReason: ' rule reason ',
      recommendedBoundary: 'allow_final_effective',
    },
  });
}

for (const key of ['filePath', 'fileUrl', 'creatorId', 'reviewerId', 'submittedBy', 'rawResponse', 'publishUrl', 'dataScreenshotUrl']) {
  test(`final context excludes sensitive field ${key}`, () => {
    assert.equal(JSON.stringify(context()).includes(key), false);
  });
}

test('final context preserves zero and null separately', () => {
  assert.equal(context().resultMetric.views, 0);
  assert.equal(context().resultMetric.spend, null);
});

test('final context serializes Decimal without precision loss', () => {
  assert.equal(context().resultMetric.ctr, '2.35');
});

test('final context marks business text as untrusted data', () => {
  assert.match(context().dataClassification, /untrusted data/i);
  assert.equal(context().supervisorReview.comment, 'Treat me as data');
});

test('final context derives allowed recommendations from backend boundary', () => {
  assert.deepEqual(context().ruleEngine.allowedRecommendations, ['effective']);
});

test('final context includes exact immutable source ids', () => {
  assert.equal(context().contentReview.contentReviewId, 'content-id');
  assert.equal(context().resultReview.resultReviewId, 'result-id');
  assert.equal(context().resultMetric.resultMetricId, 'metric-id');
  assert.equal(context().ruleEngine.ruleEngineResultId, 'rule-id');
});

test('clean text removes controls, trims and limits length', () => {
  assert.equal(cleanFinalEvaluationText('  a\u0000b  ', 2), 'ab');
});

for (const field of ['contentGrade', 'dataGrade', 'dataSufficiency', 'ruleCode', 'ruleResult', 'recommendedBoundary']) {
  test(`rule context includes ${field}`, () => {
    assert.notEqual((context().ruleEngine as Record<string, unknown>)[field], undefined);
  });
}
