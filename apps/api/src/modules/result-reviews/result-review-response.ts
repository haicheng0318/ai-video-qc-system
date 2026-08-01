import { Prisma } from '@prisma/client';

type StoredReview = Record<string, any>;

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function parsedAudit(rawResponse: Prisma.JsonValue | null | undefined) {
  if (!rawResponse || typeof rawResponse !== 'object' || Array.isArray(rawResponse)) return {};
  const parsed = (rawResponse as Record<string, unknown>).parsed;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

export function resultReviewResponse(review: StoredReview) {
  const parsed = parsedAudit(review.rawResponse);
  return {
    id: review.id,
    resultMetricId: review.resultMetricId,
    modelProvider: review.modelProvider,
    modelName: review.modelName,
    dataScore: review.dataScore,
    dataGrade: review.dataGrade,
    dataSufficiency: review.dataSufficiency,
    isBusinessEffectiveRecommendation: review.isBusinessEffectiveRecommendation,
    resultSummary: review.resultSummary,
    performanceProblems: arrayValue(review.performanceProblems),
    attributionAnalysis: arrayValue(review.attributionAnalysis),
    optimizationSuggestions: arrayValue(review.optimizationSuggestions),
    sufficiencyReasons: arrayValue(parsed.sufficiencyReasons),
    continueTestRecommendation: typeof parsed.continueTestRecommendation === 'string'
      ? parsed.continueTestRecommendation
      : null,
    status: review.status,
    errorMessage: review.errorMessage,
    createdAt: new Date(review.createdAt).toISOString(),
  };
}
