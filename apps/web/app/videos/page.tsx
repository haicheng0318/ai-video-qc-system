'use client';

import Link from 'next/link';
import Image from 'next/image';
import { FormEvent, ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch, ApiUser } from '@/lib/api';
import { contentEvaluationDisplay, displayLabel, videoStatusLabels } from '@/lib/display-labels';
import { GradeBadge, StatusBadge } from '@/components/ui/badges';

type V11Group = { status: string; decision?: { totalScore?: string | number | null; contentRating?: string | null; decisionSource?: string | null }; workflowRevision?: { revision: number }; holds?: Array<{ id?: string; holdType?: string }>; appeals?: unknown[] };
type Video = { id: string; title: string; brand?: string; product?: string; status: string; recordState?: 'active' | 'hidden' | 'trashed'; createdAt: string; updatedAt?: string; coverUrl?: string | null; isTrial?: boolean; creator?: { id?: string; name: string }; aiResultReviews?: Array<{ dataGrade?: string | null }>; finalVideoEvaluations?: Array<{ finalGrade?: string | null }>; v11EvaluationGroups?: V11Group[]; v11DataDecisions?: Array<{ dataRating?: string | null }>; v11ComprehensiveDecisions?: Array<{ comprehensiveRating?: string | null; decisionSource?: string | null }> };
type VideoList = { items: Video[]; total?: number; page?: number; pageSize?: number };
type ViewMode = 'list' | 'card';

export default function VideosPage() {
  return <Suspense fallback={<main className="page"><p className="muted">正在加载视频列表…</p></main>}><VideoListPage /></Suspense>;
}

function VideoListPage() {
  const router = useRouter(), params = useSearchParams();
  const [result, setResult] = useState<Required<VideoList>>({ items: [], total: 0, page: 1, pageSize: 20 });
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [user, setUser] = useState<ApiUser | null>(null), [viewMode, setViewMode] = useState<ViewMode>('list');
  const [allCreators, setAllCreators] = useState<Array<{ id: string; name: string }>>([]);
  const [manualView, setManualView] = useState(false);
  const [listRevision, setListRevision] = useState(0);
  const names = ['search', 'businessStatus', 'videoType', 'month', 'creatorId', 'recordState'] as const;
  const values = Object.fromEntries(names.map((name) => [name, params.get(name) || ''])) as Record<(typeof names)[number], string>;
  const page = Math.max(1, Math.min(10000, Number(params.get('page')) || 1)), pageSize = 20;
  const queryString = new URLSearchParams({ ...Object.fromEntries(names.filter((name) => values[name]).map((name) => [name, values[name]])), page: String(page), pageSize: String(pageSize) }).toString();

  useEffect(() => {
    let active = true;
    void apiFetch<{ user: ApiUser }>('/api/auth/me').then(async ({ user: current }) => {
      if (!active) return;
      setUser(current);
      setViewMode(window.localStorage.getItem(`video-list-view:${current.id}`) === 'card' ? 'card' : 'list');
      if (current.role === 'admin') {
        const first = await apiFetch<{ items: Array<{ id: string; name: string }>; total: number; pageSize: number }>('/api/admin/users?page=1&pageSize=100');
        const users = [...first.items];
        for (let page = 2; users.length < first.total; page += 1) users.push(...(await apiFetch<{ items: Array<{ id: string; name: string }> }>(`/api/admin/users?page=${page}&pageSize=100`)).items);
        if (active) setAllCreators(users);
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    void apiFetch<VideoList>(`/api/videos?${queryString}`).then((data) => { if (active) setResult({ items: data.items, total: data.total ?? data.items.length, page: data.page ?? page, pageSize: data.pageSize ?? pageSize }); }).catch((err) => { if (active) setError(err instanceof Error ? err.message : '视频列表加载失败。'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [queryString, page, listRevision]);

  function changeView(next: ViewMode) { setViewMode(next); setManualView(true); if (user) window.localStorage.setItem(`video-list-view:${user.id}`, next); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget), next = new URLSearchParams();
    for (const name of names) { const value = String(data.get(name) || '').trim(); if (value) next.set(name, value); }
    next.set('page', '1'); router.push(`/videos?${next.toString()}`);
  }
  function go(nextPage: number) { const next = new URLSearchParams(params.toString()); next.set('page', String(nextPage)); router.push(`/videos?${next.toString()}`); }
  function removeFilter(name?: string) { const next = name ? new URLSearchParams(params.toString()) : new URLSearchParams(); if (name) next.delete(name); next.set('page', '1'); router.push(`/videos?${next.toString()}`); }
  const creators = allCreators;
  const filterLabels: Record<string, string> = { search: '搜索', businessStatus: '业务状态', videoType: '视频类型', month: '上传月份', creatorId: '上传人', recordState: '记录状态' };
  const activeFilters = names.filter((name) => values[name]);
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  return <main className="page" id="main-content">
    <div className="page-title"><div><p className="eyebrow">工作台 / 视频任务</p><h1>视频任务</h1><p className="muted">查看视频评估结果、流程进度与当前待办。</p></div><Link className="button" href="/videos/new">+ 上传视频</Link></div>
    <section className="video-workspace" data-manual-view={manualView} aria-label="视频列表">
      <div className="list-toolbar"><div className="segmented" aria-label="显示方式"><button type="button" className={viewMode === 'list' ? 'active' : ''} onClick={() => changeView('list')}>列表</button><button type="button" className={viewMode === 'card' ? 'active' : ''} onClick={() => changeView('card')}>卡片</button></div></div>
      <form key={params.toString()} className="video-filter-form" onSubmit={submit}>
        <div className="list-primary-filters">
        <Field label="搜索"><input name="search" defaultValue={values.search} placeholder="标题、品牌、产品或平台" /></Field>
        <Field label="业务状态"><select name="businessStatus" defaultValue={values.businessStatus}><option value="">全部业务状态</option><option value="pending">待处理</option><option value="processing">AI处理中</option><option value="waiting_data">待补数据</option><option value="completed">已完成</option><option value="exception">异常</option></select></Field>
        <Field label="上传月份"><input name="month" type="month" defaultValue={values.month} /></Field>
        <Field label="视频类型"><select name="videoType" defaultValue={values.videoType}><option value="">全部类型</option><option value="product_card">商品卡</option><option value="qianchuan_ad">千川投放</option><option value="live_room_traffic">直播引流</option><option value="organic">自然流</option><option value="brand_seeding">品牌种草</option><option value="other">其他</option></select></Field>
        <button className="button secondary" type="submit">筛选</button>
        </div>
        {user?.role === 'admin' ? <details className="advanced-filters" open={Boolean(values.creatorId || values.recordState)}><summary>管理筛选</summary><div className="advanced-filter-grid"><Field label="上传人"><select name="creatorId" defaultValue={values.creatorId}><option value="">全部上传人</option>{values.creatorId && !creators.some((creator) => creator.id === values.creatorId) ? <option value={values.creatorId}>当前精确账号</option> : null}{creators.map((creator) => <option key={creator.id} value={creator.id}>{creator.name}</option>)}</select></Field><Field label="记录状态"><select name="recordState" defaultValue={values.recordState || 'active'}><option value="active">正常</option><option value="hidden">已隐藏</option><option value="trashed">回收站</option></select></Field></div></details> : null}
      </form>
      {activeFilters.length ? <div className="applied-filters" aria-label="已应用筛选">{activeFilters.map((name) => <button type="button" className="filter-chip" key={name} onClick={() => removeFilter(name)} aria-label={`移除${filterLabels[name]}筛选`}>{filterLabels[name]}：{name === 'creatorId' ? creators.find((creator) => creator.id === values[name])?.name || '当前精确账号' : name === 'businessStatus' ? ({ pending: '待处理', processing: 'AI处理中', waiting_data: '待补数据', completed: '已完成', exception: '异常' } as Record<string, string>)[values[name]] : name === 'recordState' ? ({ active: '正常', hidden: '已隐藏', trashed: '回收站' } as Record<string, string>)[values[name]] : values[name]} <span aria-hidden="true">×</span></button>)}<button type="button" className="button ghost" onClick={() => removeFilter()}>清空全部</button></div> : null}
      {error ? <div className="error-state" role="alert"><p>{error}</p><button className="button secondary" type="button" onClick={() => setListRevision((value) => value + 1)}>重试</button></div> : null}
      {loading ? <p className="muted" role="status">正在加载视频…</p> : null}
      {!loading && !error && result.items.length === 0 ? <div className="empty-state"><p>没有符合条件的视频。</p><Link className="text-link" href="/videos/new">上传第一个视频</Link></div> : null}
      {result.items.length ? <div className="video-list-results" data-view={viewMode} data-manual-view={manualView}><div className="video-list-mode"><VideoTable videos={result.items} showCreator={user?.role === 'admin'} isAdmin={user?.role === 'admin'} onManaged={() => setListRevision((value) => value + 1)} /></div><div className="video-card-mode"><div className="video-card-grid">{result.items.map((video) => <VideoCard key={video.id} video={video} showCreator={user?.role === 'admin'} isAdmin={user?.role === 'admin'} onManaged={() => setListRevision((value) => value + 1)} />)}</div></div></div> : null}
      <div className="pagination"><span>共 {result.total} 条 · 第 {result.page}/{totalPages} 页</span><div><button className="button secondary" type="button" disabled={result.page <= 1 || loading} onClick={() => go(result.page - 1)}>上一页</button><button className="button secondary" type="button" disabled={result.page >= totalPages || loading} onClick={() => go(result.page + 1)}>下一页</button></div></div>
    </section>
  </main>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="form-field"><span>{label}</span>{children}</label>; }
function summary(video: Video) { const group = video.v11EvaluationGroups?.[0], comprehensive = video.v11ComprehensiveDecisions?.[0]; return { group, content: group?.decision?.contentRating || '—', score: group?.decision?.totalScore ?? '—', data: video.v11DataDecisions?.[0]?.dataRating || video.aiResultReviews?.[0]?.dataGrade || '—', comprehensive: comprehensive?.comprehensiveRating || video.finalVideoEvaluations?.[0]?.finalGrade || '—', hold: Boolean(group?.holds?.length), appeal: Boolean(group?.appeals?.length), revision: group?.workflowRevision?.revision || 0, source: comprehensive?.decisionSource || group?.decision?.decisionSource || '—', display: contentEvaluationDisplay({ videoStatus: video.status, groupStatus: group?.status || null, activeHoldCount: group?.holds?.length || 0 }) }; }
function VideoTable({ videos, showCreator, isAdmin, onManaged }: { videos: Video[]; showCreator: boolean; isAdmin: boolean; onManaged: () => void }) {
  return <div className="table-scroll" tabIndex={0} aria-label="视频列表，可横向滚动"><table className="decision-table"><thead><tr><th>视频</th>{showCreator ? <th>上传人</th> : null}<th>内容</th><th>数据</th><th>综合</th><th>当前状态</th><th>操作</th><th>更新时间</th></tr></thead><tbody>{videos.map((video) => {
    const state = summary(video);
    return <tr key={video.id}><td className="video-title-cell"><Link className="text-link" href={`/videos/${video.id}`}>{video.title}</Link>{video.isTrial ? <span className="trial-badge">试用</span> : null}<small className="cell-subline">{video.brand || '—'} · {video.product || '—'}</small></td>{showCreator ? <td>{video.creator?.name || '—'}</td> : null}<td><div className="compact-grade"><GradeBadge grade={state.content} /><span>{state.score}</span></div></td><td><GradeBadge grade={state.data} /></td><td><GradeBadge grade={state.comprehensive} /></td><td><StatusBadge status={state.display.state} label={state.display.label} /><div className="list-state-flags">{state.hold ? <StatusBadge status="hold" label="Hold · 流程暂停" /> : null}{state.appeal ? <StatusBadge status="appeal" label="异议处理中" /> : null}</div></td><td><Link className="text-link row-actions" href={`/videos/${video.id}`}>查看详情 <span aria-hidden="true">→</span></Link>{isAdmin ? <VideoManagementMenu video={video} onManaged={onManaged} /> : null}</td><td>{formatTime(video.updatedAt || video.createdAt)}</td></tr>;
  })}</tbody></table></div>;
}
function VideoCard({ video, showCreator, isAdmin, onManaged }: { video: Video; showCreator: boolean; isAdmin: boolean; onManaged: () => void }) {
  const state = summary(video);
  return <article className="video-card"><VideoCardCover video={video} /><div className="video-card-body"><div><Link className="text-link" href={`/videos/${video.id}`}>{video.title}</Link><p className="muted">{video.brand || '—'} · {video.product || '—'}</p></div><div className="card-comprehensive"><span>综合评级</span><GradeBadge grade={state.comprehensive} /></div><dl><div><dt>内容质量</dt><dd><GradeBadge grade={state.content} /> {state.score}</dd></div><div><dt>数据表现</dt><dd><GradeBadge grade={state.data} /></dd></div></dl><StatusBadge status={state.display.state} label={state.display.label} /><div className="list-state-flags">{state.hold ? <StatusBadge status="hold" label="Hold · 流程暂停" /> : null}{state.appeal ? <StatusBadge status="appeal" label="异议处理中" /> : null}</div><Link className="text-link" href={`/videos/${video.id}`}>查看详情 →</Link><footer>{showCreator ? <span>{video.creator?.name || '—'} · </span> : null}<time>{formatTime(video.updatedAt || video.createdAt)}</time></footer>{isAdmin ? <VideoManagementMenu video={video} onManaged={onManaged} /> : null}</div></article>;
}

function VideoCardCover({ video }: { video: Video }) {
  const host = useRef<HTMLDivElement>(null), [visible, setVisible] = useState(false);
  useEffect(() => {
    if (video.coverUrl || !host.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: '120px' });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [video.coverUrl]);
  return <div className="video-card-cover" ref={host}>
    {video.coverUrl ? <Image src={video.coverUrl} alt="" width={1280} height={720} unoptimized priority={false} /> : visible ? <video src={`/api/videos/${video.id}/file`} preload="metadata" muted playsInline aria-hidden="true" /> : <span>视频封面</span>}
  </div>;
}

function VideoManagementMenu({ video, onManaged }: { video: Video; onManaged: () => void }) {
  async function setState(action: 'hide' | 'trash' | 'restore') {
    const reason = window.prompt(action === 'hide' ? '隐藏原因（1–500字）' : action === 'trash' ? '移入回收站原因（1–500字）' : '恢复原因（1–500字）')?.trim();
    if (!reason) return;
    try { await apiFetch(`/api/videos/${video.id}/${action}`, { method: 'POST', body: JSON.stringify({ reason }) }); onManaged(); }
    catch (cause) { window.alert(cause instanceof Error ? cause.message : '操作失败'); }
  }
  return <details className="video-management-menu"><summary aria-label="视频管理">···</summary><div>{video.recordState === 'active' ? <><button type="button" onClick={() => void setState('hide')}>隐藏</button><button type="button" onClick={() => void setState('trash')}>移入回收站</button></> : <button type="button" onClick={() => void setState('restore')}>恢复</button>}</div></details>;
}
function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
