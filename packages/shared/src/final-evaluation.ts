export const FINAL_EVALUATION_VERSION = 'final-evaluation-v1' as const;
export const finalRecommendationGrades = ['effective', 'low_effective', 'invalid'] as const;
export const finalRecommendationStatuses = ['final_effective', 'final_low_effective', 'final_invalid'] as const;

export type FinalRecommendationGrade = (typeof finalRecommendationGrades)[number];
export type FinalRecommendationStatus = (typeof finalRecommendationStatuses)[number];

export type FinalEvaluationView = {
  id: string;
  contentReviewId: string;
  resultReviewId: string;
  ruleEngineResultId: string;
  evaluationVersion: typeof FINAL_EVALUATION_VERSION;
  modelProvider: string;
  modelName: string;
  contentGrade: string;
  dataGrade: string;
  recommendedFinalGrade: FinalRecommendationGrade | null;
  recommendedFinalStatus: FinalRecommendationStatus | null;
  recommendedIsEffective: boolean | null;
  recommendationConfidence: number | null;
  decisionSummary: string | null;
  evidenceAssessment: Array<Record<string, unknown>>;
  finalAttribution: Array<Record<string, unknown>>;
  finalSuggestion: string | null;
  confirmationFocus: string[];
  riskFlags: Array<Record<string, unknown>>;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  finalGrade: FinalRecommendationGrade | null;
  finalStatus: FinalRecommendationStatus | null;
  isEffectiveFinal: boolean | null;
  canBeUsedForPerformance: boolean;
  confirmedBy: { id: string; name: string; account: string; role: string } | null;
  confirmedAt: string | null;
  manualAdjustReason: string | null;
  confirmationComment: string | null;
  isExcellentCase: boolean;
  isNegativeCase: boolean;
  caseMarkedAt: string | null;
  caseNote: string | null;
};

export type FinalEvaluationLatestResponse = {
  videoStatus: string;
  evaluation: FinalEvaluationView | null;
};

export type FinalEvaluationHistoryItem = Pick<FinalEvaluationView,
  'id' | 'ruleEngineResultId' | 'evaluationVersion' | 'modelName' | 'status' |
  'recommendedFinalGrade' | 'recommendedFinalStatus' | 'recommendationConfidence' |
  'errorMessage' | 'createdAt' | 'completedAt' | 'finalGrade' | 'finalStatus' | 'confirmedAt'> & { isLatest: boolean };

export type FinalEvaluationHistoryResponse = {
  items: FinalEvaluationHistoryItem[];
  nextCursor: string | null;
};
