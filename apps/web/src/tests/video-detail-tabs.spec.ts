import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('video detail keeps player and business panels mounted across four modular tabs', async () => {
  const page = await readFile(resolve(__dirname, '../../app/videos/[id]/page.tsx'), 'utf8');
  assert.match(page, /detail-tabs/);
  assert.match(page, /hidden=\{activeTab !==/);
  for (const label of ['内容评估', '数据表现', '综合结果', '记录']) assert.match(page, new RegExp(label));
  for (const label of ['内容质量 · 历史评估', '数据表现等级', '最终有效等级']) assert.match(page, new RegExp(label));
  assert.doesNotMatch(page, /<VideoPlayer[^>]*key=/);
});
