export const V11_CONTENT_SCORING_VERSION = 'content-score-v1.1';
export const V11_CONTENT_RATING_VERSION = 'content-rating-v1.1';

export const V11_CONTENT_DIMENSIONS = [
  { code: 'opening_hook', weight: 20, critical: true },
  { code: 'selling_point', weight: 20, critical: true },
  { code: 'structure', weight: 15, critical: true },
  { code: 'visual_quality', weight: 15, critical: true },
  { code: 'pacing', weight: 10, critical: true },
  { code: 'subtitle_audio', weight: 10, critical: true },
  { code: 'platform_fit', weight: 5, critical: true },
  { code: 'action_logic', weight: 5, critical: true },
] as const;

export const V11_CONTENT_ANCHORS: Record<(typeof V11_CONTENT_DIMENSIONS)[number]['code'], readonly string[]> = {
  opening_hook: ['开头不可理解、与主题无关或关键呈现严重失败', '开头泛化、重复或明显拖沓，核心信息进入较晚', '可识别大致主题，但继续观看理由偏弱或有可删铺垫', '前三秒进入主题并给出观看理由，差异化一般', '前三秒建立明确且与后续主题直接相关的观看理由'],
  selling_point: ['核心对象或价值无法识别，或明显自相矛盾', '只列特点或口号，核心卖点难理解', '可识别对象及至少一个价值点，但证据少或主次不清', '对象和核心价值明确，有一定支撑', '对象、用户价值和差异表达清楚，并有画面、演示或事实支持'],
  structure: ['无可识别主线或关键信息互相冲突', '顺序混乱、段落断裂或多个关键关系缺失', '主要信息可理解，但有跳跃、重复或局部缺环', '主线清楚且关键段落完整', '开始、展开、证据或演示、收束与用途一致且递进清晰'],
  visual_quality: ['关键内容基本无法辨识或画面严重错误', '关键主体持续不清、严重遮挡或镜头妨碍理解', '画面基本可辨，但多个片段影响观看体验', '整体清楚可用，局部问题不影响核心信息', '主体清晰，曝光、构图、镜头和场景均服务表达'],
  pacing: ['严重剪辑断裂、持续不可读或无法理解关键过程', '多个关键片段节奏失衡，造成理解负担或大量等待', '存在重复、拖延或过密片段，理解尚可', '整体流畅，少量片段偏慢或偏快', '节奏与目标匹配，信息可吸收且无明显冗余'],
  subtitle_audio: ['关键文字或口播基本无法理解，或严重错字、不同步', '多处关键信息因字幕或声音问题遗漏或误解', '部分字幕难读、口播不清或声画冲突，但核心可理解', '主要信息清楚，存在少量字幕或声音细节问题', '实际信息通道清楚、同步、可理解且不妨碍核心信息'],
  platform_fit: ['与已声明目标严重冲突，核心用途无法实现', '主要呈现与用途明显偏离', '部分适配但目标不清，存在形式或用途错配', '基本适配，少量呈现或组织可优化', '形式、时长、信息方式与声明的平台、用途和受众一致'],
  action_logic: ['无法识别与目标相关的下一步逻辑，或引导与内容冲突', '只有孤立口号或按钮，未形成有效动机', '行动方向可理解，理由偏弱或与前文连接不足', '有明确行动理由，但力度或连接一般', '清楚建立与用途一致且信息、动机充分的下一步理由'],
};

export type V11ContentDimension = (typeof V11_CONTENT_DIMENSIONS)[number]['code'];
export type V11ContentRating = 'A+' | 'A' | 'B' | 'B-' | 'C' | 'D';
export type V11ComplianceStatus = 'clear' | 'suspected' | 'confirmed';

export type V11DimensionObservation = {
  dimension: V11ContentDimension;
  observationStatus: 'observed' | 'unknown';
  anchor?: number | null;
  facts: string[];
  evidence: Array<{ startSeconds: number | null; endSeconds: number | null; reference: string | null; description: string }>;
  observation: string;
};

export type V11ContentScoringInput = {
  dimensions: V11DimensionObservation[];
  compliance: { status: V11ComplianceStatus; facts: string[] };
};

export function contentRatingFromScore(score: number): V11ContentRating {
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('Content score must be between 0 and 100.');
  if (score >= 90) return 'A+';
  if (score >= 82) return 'A';
  if (score >= 74) return 'B';
  if (score >= 68) return 'B-';
  if (score >= 60) return 'C';
  return 'D';
}

function roundOne(value: number) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

export function calculateV11ContentScore(input: V11ContentScoringInput) {
  if (input.dimensions.length !== V11_CONTENT_DIMENSIONS.length) {
    throw new Error('Every V1.1 content dimension must be provided exactly once.');
  }
  const byDimension = new Map(input.dimensions.map((item) => [item.dimension, item]));
  if (byDimension.size !== V11_CONTENT_DIMENSIONS.length) {
    throw new Error('Every V1.1 content dimension must be provided exactly once.');
  }

  const unknownDimensions: V11ContentDimension[] = [];
  const dimensions = V11_CONTENT_DIMENSIONS.map((definition) => {
    const observation = byDimension.get(definition.code);
    if (!observation) throw new Error(`Missing content dimension: ${definition.code}.`);
    if (observation.observationStatus === 'unknown') {
      unknownDimensions.push(definition.code);
      return { ...observation, anchor: null, weight: definition.weight, score: null };
    }
    if (!Number.isInteger(observation.anchor) || observation.anchor! < 0 || observation.anchor! > 4) {
      throw new Error(`Invalid anchor for ${definition.code}. Anchor must be an integer from 0 to 4.`);
    }
    return {
      ...observation,
      anchor: observation.anchor!,
      weight: definition.weight,
      score: definition.weight * observation.anchor! / 4,
    };
  });

  const complete = unknownDimensions.length === 0;
  const totalScore = complete
    ? roundOne(dimensions.reduce((sum, item) => sum + (item.score ?? 0), 0))
    : null;
  return {
    scoringVersion: V11_CONTENT_SCORING_VERSION,
    ratingVersion: V11_CONTENT_RATING_VERSION,
    complete,
    unknownDimensions,
    dimensions,
    totalScore,
    contentRating: totalScore === null ? null : contentRatingFromScore(totalScore),
    compliance: input.compliance,
  };
}
