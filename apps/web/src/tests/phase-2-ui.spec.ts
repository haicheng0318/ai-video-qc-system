import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { contentDimensionLabels } from '../lib/display-labels';

test('all deterministic content dimensions have stable Chinese labels', () => {
  assert.deepEqual(contentDimensionLabels, {
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
  });
});

test('video detail explains deterministic and legacy content score sources', async () => {
  const page = await readFile(resolve(__dirname, '../../app/videos/[id]/page.tsx'), 'utf8');
  assert.match(page, /评分规则：/);
  assert.match(page, /总分由后端规则计算/);
  assert.match(page, /历史模型评分/);
  assert.match(page, /contentDimensionLabels/);
  assert.match(page, /scoreCalculation/);
});
