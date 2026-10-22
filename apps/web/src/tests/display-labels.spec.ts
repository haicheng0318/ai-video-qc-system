import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  attributionTypeLabels,
  boundaryLabels,
  contentEvaluationDisplay,
  displayLabel,
  holdReasonLabel,
  metricConceptLabel,
  operationLogActionLabels,
  reviewStatusLabels,
  videoStatusLabels,
  videoTypeLabels,
} from '../lib/display-labels';

test('business enums have stable Chinese labels', () => {
  assert.equal(displayLabel(videoTypeLabels, 'product_card'), '商品卡视频');
  assert.equal(displayLabel(videoStatusLabels, 'pending_final_confirmation'), '等待负责人确认');
  assert.equal(displayLabel(reviewStatusLabels, 'succeeded'), '已完成');
  assert.equal(displayLabel(attributionTypeLabels, 'product_page'), '商品详情页承接');
  assert.equal(displayLabel(boundaryLabels, 'allow_final_effective'), '仅允许建议为有效');
  assert.equal(displayLabel(operationLogActionLabels, 'rule_engine_executed'), '后端规则引擎已执行');
});

test('active V1.1 hold overrides the compatibility failed status without hiding true failures', () => {
  assert.deepEqual(contentEvaluationDisplay({
    videoStatus: 'ai_content_failed',
    groupStatus: 'hold',
    activeHoldCount: 1,
  }), {
    label: '评估结果待确认',
    state: 'warning',
    description: 'AI评估已完成，但多次结果存在分歧，未形成正式内容决议。',
  });
  assert.equal(contentEvaluationDisplay({
    videoStatus: 'ai_content_failed',
    groupStatus: null,
    activeHoldCount: 0,
  }).label, '内容评估失败');
});

test('hold reasons use business wording while retaining unknown reasons safely', () => {
  assert.equal(holdReasonLabel('评估结果存在严重分歧：major_fact_conflict'), '多次评估对关键事实判断不一致');
  assert.equal(holdReasonLabel('soft_fact_conflict_unresolved'), '多次评估对行动提示判断仍未形成多数结论');
  assert.equal(holdReasonLabel('score_difference_over_ten'), '多次评估分数差异较大');
  assert.equal(holdReasonLabel('rating_difference_two_levels'), '多次评估等级差异较大');
  assert.equal(holdReasonLabel('major_compliance_conflict'), '多次评估的合规判断存在重大分歧');
  assert.equal(holdReasonLabel('等待复核素材完整性'), '等待复核素材完整性');
});

test('known model metric concepts are localized while industry abbreviations remain usable', () => {
  assert.equal(metricConceptLabel('Sample Size'), '样本量');
  assert.equal(metricConceptLabel('Data_Consistency'), '数据一致性');
  assert.equal(metricConceptLabel('ROI'), 'ROI');
});
