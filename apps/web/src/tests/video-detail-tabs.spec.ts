import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('video detail keeps player and workflow panels mounted while switching eight tabs', async () => {
  const page = await readFile(resolve(__dirname, '../../app/videos/[id]/page.tsx'), 'utf8');
  assert.match(page, /detail-tabs/);
  assert.match(page, /hidden=\{activeTab !==/);
  for (const label of ['内容评估', '主管审核', '运营投放数据', '数据复盘', '规则与最终建议', '负责人确认', '版本历史', '操作记录']) assert.match(page, new RegExp(label));
  for (const label of ['内容质量等级', '数据表现等级', '最终有效等级']) assert.match(page, new RegExp(label));
  assert.doesNotMatch(page, /<VideoPlayer[^>]*key=/);
});
