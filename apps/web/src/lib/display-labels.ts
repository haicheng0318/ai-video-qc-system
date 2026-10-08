export const videoTypeLabels: Record<string, string> = {
  product_card: '商品卡视频',
  qianchuan_ad: '千川投放视频',
  live_room_traffic: '直播间引流视频',
  organic: '自然流视频',
  brand_seeding: '品牌种草视频',
  other: '其他',
};

export const contentDimensionLabels: Record<string, string> = {
  hook: '前3秒吸引力',
  product_exposure: '产品露出',
  selling_points: '卖点表达',
  visual_quality: '画面质感',
  composition: '构图',
  camera_language: '镜头语言',
  pacing: '节奏',
  subtitle_clarity: '字幕清晰度',
  voiceover_clarity: '口播清晰度',
  bgm_fit: 'BGM匹配度',
  platform_fit: '平台适配',
  purpose_fit: '用途适配',
};

export const videoStatusLabels: Record<string, string> = {
  submitted: '待内容评估',
  ai_content_reviewing: '内容评估中',
  ai_content_failed: '内容评估失败',
  pending_supervisor_review: '等待主管初审',
  approved_for_publish: '已通过主管初审',
  revision_required: '要求返修',
  invalid_content: '内容无效',
  pending_result_data: '结果数据已补充，等待触发复盘',
  ai_result_reviewing: '千问数据复盘中',
  ai_result_failed: '千问数据复盘失败',
  pending_rule_engine: '等待规则引擎判断',
  pending_final_evaluation: '等待生成千问最终建议',
  final_evaluation_failed: '千问最终建议生成失败',
  pending_final_confirmation: '等待负责人确认',
  pending_data: '数据不足，等待补充',
  final_effective: '有效',
  final_low_effective: '低有效',
  final_invalid: '无效',
  excellent_case: '已纳入优秀案例',
  negative_case: '已纳入反面案例',
};

export const reviewStatusLabels: Record<string, string> = {
  pending: '等待处理',
  running: '处理中',
  succeeded: '已完成',
  failed: '失败',
};

export const finalGradeLabels: Record<string, string> = {
  effective: '有效',
  low_effective: '低有效',
  invalid: '无效',
};

export const finalStatusLabels: Record<string, string> = {
  final_effective: '有效',
  final_low_effective: '低有效',
  final_invalid: '无效',
};

export const severityLabels: Record<string, string> = {
  high: '高', medium: '中', low: '低', critical: '严重',
};

export const priorityLabels: Record<string, string> = {
  high: '高优先级', medium: '中优先级', low: '低优先级',
};

export const attributionTypeLabels: Record<string, string> = {
  content: '内容因素',
  delivery: '投放设置',
  audience: '人群定向',
  price: '价格因素',
  product_page: '商品详情页承接',
  live_room: '直播间承接',
  activity: '活动机制',
  sample_size: '样本量',
  external: '外部异常因素',
};

export const evidenceSourceLabels: Record<string, string> = {
  content_review: '内容质量评估',
  result_review: '投放数据复盘',
  rule_engine: '后端规则引擎',
  supervisor_review: '主管初审',
};

export const riskFlagLabels: Record<string, string> = {
  content_data_conflict: '内容与数据表现存在偏差',
  boundary_sensitive: '结论对规则边界敏感',
  weak_evidence: '支撑证据较弱',
  insufficient_data: '数据不足',
};

export const ruleResultLabels: Record<string, string> = {
  pending_data: '等待补充数据',
  excellent_effective_candidate: '优秀有效候选',
  effective_candidate: '有效候选',
  potential_effective_candidate: '潜在有效候选',
  basic_effective_candidate: '基础有效候选',
  content_good_result_poor: '内容较好、数据较弱',
  abnormal_need_confirmation: '表现异常，需要人工确认',
  invalid_candidate: '无效候选',
};

export const boundaryLabels: Record<string, string> = {
  pending_data: '暂停最终评定，等待补充数据',
  allow_final_effective: '仅允许建议为有效',
  allow_final_effective_or_low_effective: '允许建议为有效或低有效',
  allow_final_low_effective_or_invalid: '允许建议为低有效或无效',
  require_manual_confirmation: '必须由负责人人工复核',
  require_final_invalid: '仅允许建议为无效',
};

export const operationLogActionLabels: Record<string, string> = {
  login_success: '登录成功', login_failed: '登录失败', permission_denied: '权限校验未通过',
  video_uploaded: '上传视频', video_detail_viewed: '查看视频详情', video_file_accessed: '访问视频文件',
  ai_content_review_started: '开始内容评估', ai_content_review_recovered: '回收超时内容评估',
  ai_content_review_completed: '内容评估完成', ai_content_review_failed: '内容评估失败', ai_content_review_viewed: '查看内容评估',
  supervisor_review_approved: '主管初审通过', supervisor_review_revision_required: '主管要求返修',
  supervisor_review_invalid_content: '主管判定内容无效', supervisor_review_viewed: '查看主管初审',
  video_revision_uploaded: '上传返修版本', result_metric_snapshot_created: '创建结果数据快照',
  platform_benchmark_created: '创建平台基准', platform_benchmark_updated: '更新平台基准',
  ai_result_review_started: '开始千问数据复盘', ai_result_review_recovered: '回收超时数据复盘',
  ai_result_review_completed: '千问数据复盘完成', ai_result_review_failed: '千问数据复盘失败',
  rule_engine_executed: '后端规则引擎已执行', final_evaluation_started: '开始生成千问最终建议',
  final_evaluation_recovered: '回收超时最终建议任务', final_evaluation_completed: '千问最终建议生成完成',
  final_evaluation_failed: '千问最终建议生成失败', final_evaluation_confirmed: '负责人已确认最终结论',
  final_grade_adjusted: '负责人调整最终等级', excellent_case_marked: '标记为优秀案例',
  negative_case_marked: '标记为反面案例', case_mark_removed: '移除案例标记',
};

export function displayLabel(labels: Record<string, string>, value: string | null | undefined) {
  if (!value) return '-';
  return labels[value] || value;
}

export function metricConceptLabel(value: string) {
  const key = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
  const labels: Record<string, string> = {
    'sample size': '样本量',
    'data consistency': '数据一致性',
    'completion rate': '完播率',
    'conversion rate': '转化率',
    'product click rate': '商品点击率',
  };
  return labels[key] || value;
}

export function operationLogDescription(actionType: string, original: string | null | undefined) {
  return operationLogActionLabels[actionType] || original || '-';
}

export function userFacingErrorMessage(value: string | null | undefined, fallback: string) {
  return value && /[一-鿿]/.test(value) ? value : fallback;
}
