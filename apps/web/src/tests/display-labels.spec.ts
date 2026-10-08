import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  attributionTypeLabels,
  boundaryLabels,
  displayLabel,
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

test('known model metric concepts are localized while industry abbreviations remain usable', () => {
  assert.equal(metricConceptLabel('Sample Size'), '样本量');
  assert.equal(metricConceptLabel('Data_Consistency'), '数据一致性');
  assert.equal(metricConceptLabel('ROI'), 'ROI');
});
