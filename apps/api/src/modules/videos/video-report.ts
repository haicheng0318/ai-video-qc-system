const formulaPrefix = /^[=+\-@\t]/;

function safeText(value: unknown, maximum = 20_000) {
  const text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\r\n]/g, ' ').slice(0, maximum);
}

export function csvCell(value: unknown) {
  let text = safeText(value);
  if (formulaPrefix.test(text.trimStart())) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function rowsToCsv(rows: unknown[][]) {
  return `\ufeff${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function shanghaiDateTime(value: unknown) {
  if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(date);
}

export function videoReportRows(video: Record<string, any>, contentOnly: boolean) {
  const content = video.aiContentReviews?.[0];
  const result = video.aiResultReviews?.[0];
  const final = video.finalVideoEvaluations?.[0];
  const rows: unknown[][] = [
    ['项目', '内容'], ['视频ID', video.id], ['标题', video.title], ['当前状态', video.status],
    ['内容质量等级', content?.contentGrade || ''], ['内容摘要', content?.contentSummary || ''],
    ['主要问题', content?.mainProblems || []], ['修改建议', content?.revisionSuggestions || []],
  ];
  if (!contentOnly) rows.push(
    ['数据表现等级', result?.dataGrade || ''], ['数据充分性', result?.dataSufficiency || ''], ['数据复盘摘要', result?.resultSummary || ''],
    ['最终有效等级', final?.finalGrade || ''], ['最终建议', final?.finalSuggestion || ''], ['负责人确认时间（北京时间）', shanghaiDateTime(final?.confirmedAt)],
  );
  return rows;
}
