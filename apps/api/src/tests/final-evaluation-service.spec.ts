import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AiReviewStatus, DataSufficiency, VideoStatus } from '@prisma/client';
import { FinalEvaluationsService, sanitizeFinalEvaluationText } from '../modules/final-evaluations/final-evaluations.service';
import { finalEvaluationHistoryResponse, finalEvaluationResponse } from '../modules/final-evaluations/final-evaluation-response';
import { FinalEvaluationSourceBindingError } from '../modules/ai/gpt/gpt.errors';

function service() {
  return new FinalEvaluationsService({} as any, {} as any, {} as any, {} as any, () => undefined);
}

function sources() {
  return {
    video: { id: 'video', status: VideoStatus.pending_final_evaluation },
    supervisorReview: { decision: VideoStatus.approved_for_publish, isAllowedToPublish: true },
    contentReview: { id: 'content', videoId: 'video', status: AiReviewStatus.succeeded, contentGrade: 'A' },
    resultReview: {
      id: 'result', videoId: 'video', status: AiReviewStatus.succeeded, resultMetricId: 'metric',
      dataGrade: 'A', dataSufficiency: DataSufficiency.sufficient,
    },
    latestResultReview: { id: 'result' },
    metric: { id: 'metric', videoId: 'video' },
    latestMetric: { id: 'metric' },
    ruleResult: {
      id: 'rule', videoId: 'video', contentReviewId: 'content', resultReviewId: 'result',
      ruleVersion: 'rule-engine-v1', contentGrade: 'A', dataGrade: 'A',
      dataSufficiency: DataSufficiency.sufficient, ruleCode: 'R11_CONTENT_HIGH_DATA_HIGH',
      ruleResult: 'excellent_effective_candidate', recommendedBoundary: 'allow_final_effective',
    },
    latestRule: { id: 'rule' },
  };
}

test('complete exact source chain passes deterministic integrity review', () => {
  assert.doesNotThrow(() => (service() as any).assertSources(sources(), 'rule'));
});

const invalidSources: Array<[string, (value: any) => void]> = [
  ['non-latest rule', (value) => { value.latestRule.id = 'other'; }],
  ['missing supervisor review', (value) => { value.supervisorReview = null; }],
  ['supervisor rejected', (value) => { value.supervisorReview.decision = VideoStatus.invalid_content; }],
  ['publication explicitly denied', (value) => { value.supervisorReview.isAllowedToPublish = false; }],
  ['missing content review', (value) => { value.contentReview = null; }],
  ['failed content review', (value) => { value.contentReview.status = AiReviewStatus.failed; }],
  ['missing result review', (value) => { value.resultReview = null; }],
  ['failed result review', (value) => { value.resultReview.status = AiReviewStatus.failed; }],
  ['missing result metric', (value) => { value.metric = null; }],
  ['metric not latest', (value) => { value.latestMetric.id = 'other'; }],
  ['result review not latest', (value) => { value.latestResultReview.id = 'other'; }],
  ['wrong rule version', (value) => { value.ruleResult.ruleVersion = 'rule-engine-v2'; }],
  ['insufficient rule data', (value) => { value.ruleResult.dataSufficiency = DataSufficiency.insufficient; value.ruleResult.dataGrade = null; }],
  ['pending data boundary', (value) => { value.ruleResult.recommendedBoundary = 'pending_data'; }],
  ['missing content source id', (value) => { value.ruleResult.contentReviewId = null; }],
  ['missing result source id', (value) => { value.ruleResult.resultReviewId = null; }],
  ['content grade drift', (value) => { value.contentReview.contentGrade = 'B'; }],
  ['data grade drift', (value) => { value.resultReview.dataGrade = 'B'; }],
  ['data sufficiency drift', (value) => { value.resultReview.dataSufficiency = DataSufficiency.insufficient; }],
  ['rule code tampering', (value) => { value.ruleResult.ruleCode = 'R33_CONTENT_LOW_DATA_LOW'; }],
  ['rule result tampering', (value) => { value.ruleResult.ruleResult = 'invalid_candidate'; }],
  ['boundary tampering', (value) => { value.ruleResult.recommendedBoundary = 'require_final_invalid'; }],
  ['invalid content grade', (value) => { value.ruleResult.contentGrade = 'X'; value.contentReview.contentGrade = 'X'; }],
  ['invalid data grade', (value) => { value.ruleResult.dataGrade = 'X'; value.resultReview.dataGrade = 'X'; }],
];
for (const [name, mutate] of invalidSources) {
  test(`${name} blocks final evaluation before OpenAI`, () => {
    const value = structuredClone(sources());
    mutate(value);
    assert.throws(() => (service() as any).assertSources(value, 'rule'));
  });
}

test('background source drift maps to a safe binding error', () => {
  const value = sources();
  value.latestMetric.id = 'other';
  assert.throws(() => (service() as any).assertSources(value, 'rule', true), FinalEvaluationSourceBindingError);
});

test('final response never exposes rawResponse or successKey and safely exposes confirmation fields', () => {
  const response = finalEvaluationResponse({
    id: 'evaluation', contentReviewId: 'content', resultReviewId: 'result', ruleEngineResultId: 'rule',
    evaluationVersion: 'final-evaluation-v1', modelProvider: 'openai', modelName: 'gpt', contentGrade: 'A', dataGrade: 'A',
    recommendedFinalGrade: null, recommendedFinalStatus: null, recommendedIsEffective: null,
    recommendationConfidence: null, decisionSummary: null, evidenceAssessment: [], finalAttribution: [],
    finalSuggestion: null, confirmationFocus: [], riskFlags: [], status: 'running', errorMessage: null,
    createdAt: new Date(), completedAt: null, rawResponse: { secret: true }, successKey: 'secret', confirmedBy: 'owner',
    confirmer: { id: 'owner', name: 'Owner', account: 'owner', role: 'content_owner' },
    finalGrade: 'effective', finalStatus: 'final_effective', isEffectiveFinal: true,
    canBeUsedForPerformance: true, confirmedAt: new Date(), manualAdjustReason: null,
    confirmationComment: 'confirmed', isExcellentCase: false, isNegativeCase: false,
    caseMarkedAt: null, caseNote: null,
  }) as Record<string, unknown>;
  assert.equal('rawResponse' in response, false);
  assert.equal('successKey' in response, false);
  assert.deepEqual(response.confirmedBy, { id: 'owner', name: 'Owner', account: 'owner', role: 'content_owner' });
  assert.equal(response.finalGrade, 'effective');
});

test('history response remains a narrow immutable summary', () => {
  const response = finalEvaluationHistoryResponse({
    id: 'evaluation', ruleEngineResultId: 'rule', evaluationVersion: 'final-evaluation-v1', modelName: 'gpt',
    status: 'failed', recommendedFinalGrade: null, recommendedFinalStatus: null, recommendationConfidence: null,
    errorMessage: 'safe', createdAt: new Date(), completedAt: new Date(), evidenceAssessment: [], finalAttribution: [],
    confirmationFocus: [], riskFlags: [],
  }, true) as Record<string, unknown>;
  assert.equal(response.isLatest, true);
  assert.equal('decisionSummary' in response, false);
  assert.equal('rawResponse' in response, false);
});

test('final evaluation sanitization removes all secret occurrences and infrastructure data', () => {
  const original = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'secret-key';
  try {
    const safe = sanitizeFinalEvaluationText('secret-key secret-key Bearer abc postgresql://user:pass@host/db /Users/name/video');
    assert.equal(safe?.includes('secret-key'), false);
    assert.equal(safe?.includes('abc'), false);
    assert.equal(safe?.includes('user:pass'), false);
    assert.equal(safe?.includes('/Users/name'), false);
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
});
