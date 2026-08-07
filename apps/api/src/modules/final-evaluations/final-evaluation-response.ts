function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export function finalEvaluationResponse(evaluation: Record<string, any>) {
  return {
    id: evaluation.id,
    contentReviewId: evaluation.contentReviewId,
    resultReviewId: evaluation.resultReviewId,
    ruleEngineResultId: evaluation.ruleEngineResultId,
    evaluationVersion: evaluation.evaluationVersion,
    modelProvider: evaluation.modelProvider,
    modelName: evaluation.modelName,
    contentGrade: evaluation.contentGrade,
    dataGrade: evaluation.dataGrade,
    recommendedFinalGrade: evaluation.recommendedFinalGrade,
    recommendedFinalStatus: evaluation.recommendedFinalStatus,
    recommendedIsEffective: evaluation.recommendedIsEffective,
    recommendationConfidence: evaluation.recommendationConfidence,
    decisionSummary: evaluation.decisionSummary,
    evidenceAssessment: arrayValue(evaluation.evidenceAssessment),
    finalAttribution: arrayValue(evaluation.finalAttribution),
    finalSuggestion: evaluation.finalSuggestion,
    confirmationFocus: arrayValue(evaluation.confirmationFocus),
    riskFlags: arrayValue(evaluation.riskFlags),
    status: evaluation.status,
    errorMessage: evaluation.errorMessage,
    createdAt: new Date(evaluation.createdAt).toISOString(),
    completedAt: evaluation.completedAt ? new Date(evaluation.completedAt).toISOString() : null,
  };
}

export function finalEvaluationHistoryResponse(evaluation: Record<string, any>, isLatest: boolean) {
  const response = finalEvaluationResponse(evaluation);
  return {
    id: response.id,
    ruleEngineResultId: response.ruleEngineResultId,
    evaluationVersion: response.evaluationVersion,
    modelName: response.modelName,
    status: response.status,
    recommendedFinalGrade: response.recommendedFinalGrade,
    recommendedFinalStatus: response.recommendedFinalStatus,
    recommendationConfidence: response.recommendationConfidence,
    errorMessage: response.errorMessage,
    createdAt: response.createdAt,
    completedAt: response.completedAt,
    isLatest,
  };
}
