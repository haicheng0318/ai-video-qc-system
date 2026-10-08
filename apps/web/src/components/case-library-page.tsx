'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { displayLabel, finalGradeLabels, videoTypeLabels } from '@/lib/display-labels';
import { formatShanghaiDateTime } from '@/lib/display-time';

type CaseItem = {
  evaluationId: string;
  videoId: string; title: string; brand: string | null; product: string | null; platform: string | null; videoType: string; creator: { name: string };
  contentGrade: string; dataGrade: string | null; finalGrade: string; recommendedFinalGrade: string;
  finalSuggestion: string; caseNote: string; caseMarkedAt: string; caseMarkedBy: { name: string } | null;
};

export function CaseLibraryPage({ type }: { type: 'excellent' | 'negative' }) {
  const [items, setItems] = useState<CaseItem[]>([]);
  const [brand, setBrand] = useState('');
  const [platform, setPlatform] = useState('');
  const [error, setError] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const load = useCallback(async (cursor?: string) => {
    const query = new URLSearchParams({ type, limit: '20' });
    if (brand.trim()) query.set('brand', brand.trim());
    if (platform.trim()) query.set('platform', platform.trim());
    if (cursor) query.set('cursor', cursor);
    try {
      const result = await apiFetch<{ items: CaseItem[]; nextCursor: string | null }>(`/api/cases?${query}`);
      setItems((current) => cursor ? [...current, ...result.items] : result.items);
      setNextCursor(result.nextCursor); setError('');
    } catch { setError('案例列表暂时不可用。'); }
  }, [brand, platform, type]);
  useEffect(() => { void load(); }, [load]);
  const title = type === 'excellent' ? '优秀案例库' : '反面案例库';
  const exportQuery = new URLSearchParams({ type, limit: '50' });
  if (brand.trim()) exportQuery.set('brand', brand.trim());
  if (platform.trim()) exportQuery.set('platform', platform.trim());
  return <main className="page"><div className="page-title"><div><h1>{title}</h1><p className="muted">仅展示已完成负责人确认并被人工标记的案例。</p></div><a className="button secondary" href={`/api/cases/export?${exportQuery}`} download>导出当前筛选（最多50条）</a></div>
    <section className="panel dashboard-filters"><label>品牌<input value={brand} onChange={(e) => setBrand(e.target.value)} /></label><label>平台<input value={platform} onChange={(e) => setPlatform(e.target.value)} /></label><button className="button" onClick={() => void load()}>查询</button></section>
    <section className="case-grid section-gap">{items.map((item) => <article className="case-card" key={item.evaluationId}><div><span className={`case-label ${type}`}>{title.replace('案例库', '')}</span><h2><Link href={`/videos/${item.videoId}`}>{item.title}</Link></h2><p className="muted">{item.brand || '-'} · {item.platform || '-'} · {displayLabel(videoTypeLabels, item.videoType)}</p></div><dl className="case-grades"><div><dt>内容等级</dt><dd>{item.contentGrade}</dd></div><div><dt>数据等级</dt><dd>{item.dataGrade || '-'}</dd></div><div><dt>最终等级</dt><dd>{displayLabel(finalGradeLabels, item.finalGrade)}</dd></div><div><dt>千问最终建议</dt><dd>{displayLabel(finalGradeLabels, item.recommendedFinalGrade)}</dd></div></dl><p><strong>案例说明：</strong>{item.caseNote}</p><p className="muted"><strong>千问建议摘要：</strong>{item.finalSuggestion}</p><footer>{item.creator.name} · {item.caseMarkedBy?.name || '-'} · {formatShanghaiDateTime(item.caseMarkedAt)}</footer></article>)}</section>
    {items.length === 0 && !error ? <p className="muted panel section-gap">暂无案例。</p> : null}{error ? <p className="error">{error}</p> : null}{nextCursor ? <button className="button secondary section-gap" onClick={() => void load(nextCursor)}>加载更多</button> : null}
  </main>;
}
