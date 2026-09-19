import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildContentReviewPrompt,
  CONTENT_REVIEW_PROMPT_VERSION,
} from '../modules/ai/gemini/gemini.prompt';

const prompt = buildContentReviewPrompt({
  platform: '抖音',
  videoType: 'product_card',
  brand: '测试品牌',
  product: '测试产品',
  isForAds: true,
  isEventVideo: false,
});

test('content review prompt uses the versioned zero-to-five evidence rubric', () => {
  assert.equal(CONTENT_REVIEW_PROMPT_VERSION, 'content-review-v3-deterministic-score');
  assert.match(prompt, /0=完全缺失或明显不可用/);
  assert.match(prompt, /5=表现优秀且证据充分/);
  assert.match(prompt, /必须输出全部12个维度，每个维度恰好一次/);
});

test('content review prompt delegates totals and grades to backend scoring', () => {
  assert.match(prompt, /不计算总分/);
  assert.match(prompt, /不输出S\/A\/B\/C\/D等级/);
  assert.doesNotMatch(prompt, /S=90-100/);
});
