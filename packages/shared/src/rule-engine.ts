export const RULE_ENGINE_VERSION = 'rule-engine-v1' as const;

export const contentGrades = ['S', 'A', 'B', 'C', 'D'] as const;
export const dataGrades = ['S', 'A', 'B', 'C', 'D'] as const;
export const ruleCodes = [
  'R00_DATA_INSUFFICIENT',
  'R11_CONTENT_HIGH_DATA_HIGH',
  'R12_CONTENT_HIGH_DATA_MID',
  'R13_CONTENT_HIGH_DATA_LOW',
  'R21_CONTENT_MID_DATA_HIGH',
  'R22_CONTENT_MID_DATA_MID',
  'R23_CONTENT_MID_DATA_LOW',
  'R31_CONTENT_LOW_DATA_HIGH',
  'R32_CONTENT_LOW_DATA_MID',
  'R33_CONTENT_LOW_DATA_LOW',
] as const;
export const ruleResults = [
  'pending_data',
  'excellent_effective_candidate',
  'effective_candidate',
  'potential_effective_candidate',
  'basic_effective_candidate',
  'content_good_result_poor',
  'abnormal_need_confirmation',
  'invalid_candidate',
] as const;
export const recommendedBoundaries = [
  'pending_data',
  'allow_final_effective',
  'allow_final_effective_or_low_effective',
  'allow_final_low_effective_or_invalid',
  'require_manual_confirmation',
  'require_final_invalid',
] as const;

export type ContentGrade = (typeof contentGrades)[number];
export type DataGrade = (typeof dataGrades)[number];
export type RuleEngineVersion = typeof RULE_ENGINE_VERSION;
export type RuleCode = (typeof ruleCodes)[number];
export type RuleResult = (typeof ruleResults)[number];
export type RecommendedBoundary = (typeof recommendedBoundaries)[number];
export type RuleDataSufficiency = 'sufficient' | 'insufficient';

export type RuleEngineResultView = {
  id: string;
  videoId: string;
  contentReviewId: string;
  resultReviewId: string;
  ruleVersion: RuleEngineVersion;
  contentGrade: ContentGrade;
  dataGrade: DataGrade | null;
  dataSufficiency: RuleDataSufficiency;
  ruleCode: RuleCode;
  ruleResult: RuleResult;
  ruleReason: string;
  recommendedBoundary: RecommendedBoundary;
  createdAt: string;
};

export type RuleEngineLatestResponse = {
  videoStatus: string;
  ruleEngineResult: RuleEngineResultView | null;
};

export type RuleEngineHistoryItem = RuleEngineResultView & { isLatest: boolean };
export type RuleEngineHistoryResponse = {
  items: RuleEngineHistoryItem[];
  nextCursor: string | null;
};
