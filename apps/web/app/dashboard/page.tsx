'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

type Summary = {
  period: { startDate: string; endDate: string };
  finalizedCount: number; finalEffectiveCount: number; finalLowEffectiveCount: number; finalInvalidCount: number; effectiveOutputCount: number;
  finalEffectiveRate: number | null; lowEffectiveRate: number | null; effectiveOutputRate: number | null; invalidRate: number | null;
  performanceEligibleCount: number; performanceEligibleRate: number | null;
  excellentCaseCount: number; negativeCaseCount: number; gptRecommendationMatchedCount: number; gptMatchRate: number | null;
  manualAdjustedCount: number; manualAdjustmentRate: number | null;
  pipeline: { pendingDataCount: number; pendingFinalEvaluationCount: number; finalEvaluationFailedCount: number; pendingFinalConfirmationCount: number };
};
type Trend = { items: Array<{ bucket: string; finalizedCount: number; effectiveCount: number; lowEffectiveCount: number; invalidCount: number; effectiveOutputRate: number | null }> };
type Breakdown = { items: Array<{ groupKey: string; groupLabel: string; finalizedCount: number; effectiveCount: number; lowEffectiveCount: number; invalidCount: number; effectiveOutputRate: number | null }> };

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trend, setTrend] = useState<Trend | null>(null);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [groupBy, setGroupBy] = useState('brand');
  const [granularity, setGranularity] = useState<'day' | 'week'>('day');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [errors, setErrors] = useState({ summary: '', trend: '', breakdown: '' });

  const load = useCallback(async () => {
    const period = new URLSearchParams();
    if (startDate) period.set('startDate', startDate);
    if (endDate) period.set('endDate', endDate);
    const suffix = period.toString() ? `?${period}` : '';
    const breakdownQuery = new URLSearchParams(period); breakdownQuery.set('groupBy', groupBy);
    const results = await Promise.allSettled([
      apiFetch<Summary>(`/api/dashboard/summary${suffix}`),
      apiFetch<Trend>(`/api/dashboard/trend${suffix ? `${suffix}&` : '?'}granularity=${granularity}`),
      apiFetch<Breakdown>(`/api/dashboard/breakdown?${breakdownQuery}`),
    ]);
    if (results[0].status === 'fulfilled') { setSummary(results[0].value); setErrors((s) => ({ ...s, summary: '' })); }
    else setErrors((s) => ({ ...s, summary: '汇总指标暂时不可用。' }));
    if (results[1].status === 'fulfilled') { setTrend(results[1].value); setErrors((s) => ({ ...s, trend: '' })); }
    else setErrors((s) => ({ ...s, trend: '趋势数据暂时不可用。' }));
    if (results[2].status === 'fulfilled') { setBreakdown(results[2].value); setErrors((s) => ({ ...s, breakdown: '' })); }
    else setErrors((s) => ({ ...s, breakdown: '分组数据暂时不可用。' }));
  }, [endDate, granularity, groupBy, startDate]);

  useEffect(() => { void load(); }, [load]);
  const cards = summary ? [
    ['已确认视频', summary.finalizedCount], ['高有效', summary.finalEffectiveCount], ['低有效', summary.finalLowEffectiveCount],
    ['无效', summary.finalInvalidCount], ['有效产出', summary.effectiveOutputCount], ['有效产出率', `${summary.effectiveOutputRate ?? '-'}%`], ['可进入绩效参考', summary.performanceEligibleCount],
    ['优秀案例', summary.excellentCaseCount], ['反面案例', summary.negativeCaseCount], ['人工调整数', summary.manualAdjustedCount],
  ] : [];
  const maxTrend = Math.max(1, ...(trend?.items.map((item) => item.finalizedCount) || [1]));

  return <main className="page">
    <div className="page-title"><div><h1>质量与有效产出看板</h1><p className="muted">仅统计负责人已经确认的正式结论。</p></div></div>
    <section className="panel dashboard-filters"><label>开始日期<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label><label>结束日期<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label><button className="button" onClick={() => void load()}>刷新</button></section>
    {errors.summary ? <p className="error">{errors.summary}</p> : <section className="kpi-grid">{cards.map(([label, value]) => <article className="kpi" key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>}
    {summary ? <section className="panel section-gap"><h2>比例与流程积压</h2><p className="warning-list">绩效参考资格仅表示该视频可进入后续绩效参考口径，不代表系统已自动计算绩效工资。</p><div className="summary-grid"><p>高有效率：{summary.finalEffectiveRate ?? '-'}%</p><p>低有效率：{summary.lowEffectiveRate ?? '-'}%</p><p>有效产出率：{summary.effectiveOutputRate ?? '-'}%</p><p>无效率：{summary.invalidRate ?? '-'}%</p><p>人工调整率：{summary.manualAdjustmentRate ?? '-'}%</p><p>GPT 建议一致率：{summary.gptMatchRate ?? '-'}%</p><p>数据不足：{summary.pipeline.pendingDataCount}</p><p>等待最终评定：{summary.pipeline.pendingFinalEvaluationCount}</p><p>最终评定失败：{summary.pipeline.finalEvaluationFailedCount}</p><p>等待负责人确认：{summary.pipeline.pendingFinalConfirmationCount}</p></div></section> : null}
    <section className="panel section-gap"><div className="page-title"><h2>确认趋势</h2><select className="compact-select" value={granularity} onChange={(e) => setGranularity(e.target.value as 'day' | 'week')}><option value="day">按日</option><option value="week">按周</option></select></div>{errors.trend ? <p className="error">{errors.trend}</p> : <div className="trend-chart">{trend?.items.map((item) => <div className="trend-column" key={item.bucket}><div className="trend-bar" style={{ height: `${Math.max(8, item.finalizedCount / maxTrend * 150)}px` }} title={`确认 ${item.finalizedCount}`}><span>{item.finalizedCount}</span></div><small>{new Date(item.bucket).toLocaleDateString()}</small></div>)}</div>}</section>
    <section className="panel section-gap"><div className="page-title"><h2>分组表现</h2><select className="compact-select" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}><option value="brand">品牌</option><option value="platform">平台</option><option value="videoType">视频类型</option><option value="creator">编导</option></select></div>{errors.breakdown ? <p className="error">{errors.breakdown}</p> : <div className="table-scroll"><table className="table"><thead><tr><th>分组</th><th>已确认</th><th>高有效</th><th>低有效</th><th>无效</th><th>有效产出率</th></tr></thead><tbody>{breakdown?.items.map((item) => <tr key={item.groupKey}><td>{item.groupLabel}</td><td>{item.finalizedCount}</td><td>{item.effectiveCount}</td><td>{item.lowEffectiveCount}</td><td>{item.invalidCount}</td><td>{item.effectiveOutputRate ?? '-'}%</td></tr>)}</tbody></table></div>}</section>
  </main>;
}
