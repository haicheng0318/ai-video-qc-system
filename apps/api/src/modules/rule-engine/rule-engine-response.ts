import { RULE_ENGINE_VERSION } from '@ai-video-qc/shared';

export function ruleEngineResultResponse(result: Record<string, any>) {
  return {
    id: result.id,
    videoId: result.videoId,
    contentReviewId: result.contentReviewId,
    resultReviewId: result.resultReviewId,
    ruleVersion: result.ruleVersion || RULE_ENGINE_VERSION,
    contentGrade: result.contentGrade,
    dataGrade: result.dataGrade,
    dataSufficiency: result.dataSufficiency,
    ruleCode: result.ruleCode,
    ruleResult: result.ruleResult,
    ruleReason: result.ruleReason,
    recommendedBoundary: result.recommendedBoundary,
    createdAt: new Date(result.createdAt).toISOString(),
  };
}
