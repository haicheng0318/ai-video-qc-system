import assert from 'node:assert/strict';
import { test } from 'node:test';
import { csvCell, videoReportRows } from '../modules/videos/video-report';

test('CSV cells neutralize formulas, strip control characters and quote delimiters', () => {
  assert.equal(csvCell('=HYPERLINK("https://evil")'), '"\'=HYPERLINK(""https://evil"")"');
  assert.equal(csvCell('safe,field\r\nnext'), '"safe,field  next"');
});

test('visitor report contains content review only and never internal responses or links', () => {
  const rows = videoReportRows({
    id: 'video', title: '标题', status: 'pending_supervisor_review', fileUrl: 'https://signed', rawResponse: { secret: true },
    aiContentReviews: [{ contentGrade: 'A', contentSummary: '清晰', rawResponse: { secret: true }, errorMessage: 'stack' }],
    aiResultReviews: [{ dataGrade: 'S' }], finalVideoEvaluations: [{ finalGrade: 'effective' }],
  } as any, true);
  const text = rows.flat().join('|');
  assert.match(text, /内容质量等级\|A/);
  assert.doesNotMatch(text, /数据表现等级|最终有效等级|signed|secret|stack/);
});

test('full report labels and formats confirmation time as Asia/Shanghai', () => {
  const rows = videoReportRows({
    id: 'video', title: 'title', status: 'final_effective', aiContentReviews: [], aiResultReviews: [],
    finalVideoEvaluations: [{ confirmedAt: new Date('2026-09-10T00:00:00.000Z') }],
  }, false);
  assert.deepEqual(rows.at(-1), ['负责人确认时间（北京时间）', '2026/09/10 08:00:00']);
});
