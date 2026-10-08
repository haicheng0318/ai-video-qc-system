const shanghaiDateTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
const shanghaiDate = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function formatShanghaiDateTime(value: string | number | Date | null | undefined) {
  if (value == null || value === '') return '-';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : shanghaiDateTime.format(date);
}

export function formatShanghaiDate(value: string | number | Date | null | undefined) {
  if (value == null || value === '') return '-';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : shanghaiDate.format(date);
}
