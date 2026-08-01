import {
  ContentGrade,
  contentGrades,
  DataGrade,
  dataGrades,
  RecommendedBoundary,
  RuleCode,
  RuleResult,
} from '@ai-video-qc/shared';

export class RuleEngineInputError extends Error {}

export type RuleBoundaryInput = {
  contentGrade: unknown;
  dataGrade: unknown;
  dataSufficiency: unknown;
};

export type RuleBoundaryOutput = {
  contentGrade: ContentGrade;
  dataGrade: DataGrade | null;
  dataSufficiency: 'sufficient' | 'insufficient';
  ruleCode: RuleCode;
  ruleResult: RuleResult;
  ruleReason: string;
  recommendedBoundary: RecommendedBoundary;
};

type GradeGroup = 'high' | 'mid' | 'low';
type SufficientRuleKey = `${GradeGroup}_${GradeGroup}`;
type RuleDefinition = Pick<RuleBoundaryOutput, 'ruleCode' | 'ruleResult' | 'recommendedBoundary'> & {
  reason: (contentGrade: ContentGrade, dataGrade: DataGrade) => string;
};

const gradeGroup: Record<ContentGrade, GradeGroup> = {
  S: 'high', A: 'high', B: 'mid', C: 'low', D: 'low',
};

const sufficientRules: Record<SufficientRuleKey, RuleDefinition> = {
  high_high: {
    ruleCode: 'R11_CONTENT_HIGH_DATA_HIGH',
    ruleResult: 'excellent_effective_candidate',
    recommendedBoundary: 'allow_final_effective',
    reason: (content, data) => `内容等级为 ${content}，数据等级为 ${data}，数据样本充分。命中 R11：内容和数据均处于高等级，进入优秀有效候选边界。`,
  },
  high_mid: {
    ruleCode: 'R12_CONTENT_HIGH_DATA_MID',
    ruleResult: 'effective_candidate',
    recommendedBoundary: 'allow_final_effective',
    reason: (content) => `内容等级为 ${content}，数据等级为 B，数据样本充分。命中 R12：内容表现较强、数据表现中等，进入有效候选边界。`,
  },
  high_low: {
    ruleCode: 'R13_CONTENT_HIGH_DATA_LOW',
    ruleResult: 'content_good_result_poor',
    recommendedBoundary: 'allow_final_low_effective_or_invalid',
    reason: (content, data) => `内容等级为 ${content}，数据等级为 ${data}，数据样本充分。命中 R13：内容表现较强但数据结果较弱，进入低有效或无效边界复核。`,
  },
  mid_high: {
    ruleCode: 'R21_CONTENT_MID_DATA_HIGH',
    ruleResult: 'potential_effective_candidate',
    recommendedBoundary: 'allow_final_effective_or_low_effective',
    reason: (_content, data) => `内容等级为 B，数据等级为 ${data}，数据样本充分。命中 R21：内容表现中等但数据表现较强，进入潜在有效候选边界。`,
  },
  mid_mid: {
    ruleCode: 'R22_CONTENT_MID_DATA_MID',
    ruleResult: 'basic_effective_candidate',
    recommendedBoundary: 'allow_final_effective_or_low_effective',
    reason: () => '内容等级和数据等级均为 B，数据样本充分。命中 R22：内容和数据均处于中等水平，进入基础有效候选边界。',
  },
  mid_low: {
    ruleCode: 'R23_CONTENT_MID_DATA_LOW',
    ruleResult: 'content_good_result_poor',
    recommendedBoundary: 'allow_final_low_effective_or_invalid',
    reason: (_content, data) => `内容等级为 B，属于可接受但不优秀；数据等级为 ${data}，数据样本充分。命中 R23：当前结果表现较弱，进入低有效或无效边界复核。`,
  },
  low_high: {
    ruleCode: 'R31_CONTENT_LOW_DATA_HIGH',
    ruleResult: 'abnormal_need_confirmation',
    recommendedBoundary: 'require_manual_confirmation',
    reason: (content, data) => `内容等级为 ${content}，数据等级为 ${data}，数据样本充分。命中 R31：内容评分较低但数据表现较强，存在明显偏差，需要最终评定和负责人确认。`,
  },
  low_mid: {
    ruleCode: 'R32_CONTENT_LOW_DATA_MID',
    ruleResult: 'abnormal_need_confirmation',
    recommendedBoundary: 'require_manual_confirmation',
    reason: (content) => `内容等级为 ${content}，数据等级为 B，数据样本充分。命中 R32：内容评分较低但数据表现达到中等，存在一定偏差，需要最终评定和负责人确认。`,
  },
  low_low: {
    ruleCode: 'R33_CONTENT_LOW_DATA_LOW',
    ruleResult: 'invalid_candidate',
    recommendedBoundary: 'require_final_invalid',
    reason: (content, data) => `内容等级为 ${content}，数据等级为 ${data}，数据样本充分。命中 R33：内容和数据均处于较低等级，进入无效候选边界。`,
  },
};

function isContentGrade(value: unknown): value is ContentGrade {
  return typeof value === 'string' && (contentGrades as readonly string[]).includes(value);
}

function isDataGrade(value: unknown): value is DataGrade {
  return typeof value === 'string' && (dataGrades as readonly string[]).includes(value);
}

export function evaluateRuleBoundary(input: RuleBoundaryInput): RuleBoundaryOutput {
  if (!isContentGrade(input.contentGrade)) {
    throw new RuleEngineInputError('Content grade must be one of S, A, B, C or D.');
  }
  if (input.dataSufficiency === 'insufficient') {
    if (input.dataGrade !== null) {
      throw new RuleEngineInputError('Insufficient data must have a null data grade.');
    }
    return {
      contentGrade: input.contentGrade,
      dataGrade: null,
      dataSufficiency: 'insufficient',
      ruleCode: 'R00_DATA_INSUFFICIENT',
      ruleResult: 'pending_data',
      ruleReason: `内容等级为 ${input.contentGrade}，数据等级为空，数据充分性为 insufficient。GPT 数据复盘判定当前数据样本不足。命中 R00：暂停最终评定，等待补充新的运营或投放数据。`,
      recommendedBoundary: 'pending_data',
    };
  }
  if (input.dataSufficiency !== 'sufficient') {
    throw new RuleEngineInputError('Data sufficiency must be sufficient or insufficient.');
  }
  if (!isDataGrade(input.dataGrade)) {
    throw new RuleEngineInputError('Sufficient data must have a grade of S, A, B, C or D.');
  }

  const key: SufficientRuleKey = `${gradeGroup[input.contentGrade]}_${gradeGroup[input.dataGrade]}`;
  const rule = sufficientRules[key];
  return {
    contentGrade: input.contentGrade,
    dataGrade: input.dataGrade,
    dataSufficiency: 'sufficient',
    ruleCode: rule.ruleCode,
    ruleResult: rule.ruleResult,
    ruleReason: rule.reason(input.contentGrade, input.dataGrade),
    recommendedBoundary: rule.recommendedBoundary,
  };
}

export const RULE_ENGINE_V1_RULES = Object.freeze(sufficientRules);
