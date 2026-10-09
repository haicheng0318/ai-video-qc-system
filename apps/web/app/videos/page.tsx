'use client';

import Link from 'next/link';
import { FormEvent, ReactNode, Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch, ApiUser } from '@/lib/api';
import { displayLabel, videoStatusLabels } from '@/lib/display-labels';

type V11Group = { status: string; decision?: { totalScore?: string | number | null; contentRating?: string | null; decisionSource?: string | null }; workflowRevision?: { revision: number }; holds?: unknown[]; appeals?: unknown[] };
type Video = { id: string; title: string; brand?: string; product?: string; status: string; createdAt: string; coverUrl?: string | null; isTrial?: boolean; creator?: { name: string }; aiResultReviews?: Array<{ dataGrade?: string | null }>; finalVideoEvaluations?: Array<{ finalGrade?: string | null }>; v11EvaluationGroups?: V11Group[]; v11DataDecisions?: Array<{ dataRating?: string | null }>; v11ComprehensiveDecisions?: Array<{ comprehensiveRating?: string | null; decisionSource?: string | null }> };
type VideoList = { items: Video[]; total?: number; page?: number; pageSize?: number };
type ViewMode = 'list' | 'card';

function currentShanghaiMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
}

export default function VideosPage() {
  return <Suspense fallback={<main className="page"><p className="muted">正在加载视频列表…</p></main>}><VideoListPage /></Suspense>;
}

function VideoListPage() {
  const router = useRouter(), params = useSearchParams();
  const [result, setResult] = useState<Required<VideoList>>({ items: [], total: 0, page: 1, pageSize: 20 });
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [user, setUser] = useState<ApiUser | null>(null), [viewMode, setViewMode] = useState<ViewMode>('list');
  const names = ['search', 'status', 'platform', 'videoType', 'month', 'dateFrom', 'dateTo', 'contentRating', 'creatorId'] as const;
  const values = Object.fromEntries(names.map((name) => [name, params.get(name) || (name === 'month' ? currentShanghaiMonth() : '')])) as Record<(typeof names)[number], string>;
  const page = Math.max(1, Math.min(10000, Number(params.get('page')) || 1)), pageSize = 20;
  const queryString = new URLSearchParams({ ...Object.fromEntries(names.filter((name) => values[name]).map((name) => [name, values[name]])), page: String(page), pageSize: String(pageSize) }).toString();

  useEffect(() => {
    let active = true;
    void apiFetch<{ user: ApiUser }>('/api/auth/me').then(({ user: current }) => {
      if (!active) return;
      setUser(current);
      setViewMode(window.localStorage.getItem(`video-list-view:${current.id}`) === 'card' ? 'card' : 'list');
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    void apiFetch<VideoList>(`/api/videos?${queryString}`).then((data) => { if (active) setResult({ items: data.items, total: data.total ?? data.items.length, page: data.page ?? page, pageSize: data.pageSize ?? pageSize }); }).catch((err) => { if (active) setError(err instanceof Error ? err.message : '视频列表加载失败。'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [queryString, page]);

  function changeView(next: ViewMode) { setViewMode(next); if (user) window.localStorage.setItem(`video-list-view:${user.id}`, next); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget), next = new URLSearchParams();
    for (const name of names) { const value = String(data.get(name) || '').trim(); if (value) next.set(name, value); }
    next.set('page', '1'); router.push(`/videos?${next.toString()}`);
  }
  function go(nextPage: number) { const next = new URLSearchParams(params.toString()); next.set('page', String(nextPage)); router.push(`/videos?${next.toString()}`); }
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  return <main className="page" id="main-content">
    <div className="page-title"><div><p className="eyebrow">WORK QUEUE</p><h1>视频列表</h1><p className="muted">按本人数据范围查看评估、复核与下一步状态。</p></div><Link className="button" href="/videos/new">上传视频</Link></div>
    <section className="panel">
      <div className="list-toolbar"><div className="segmented" aria-label="显示方式"><button type="button" className={viewMode === 'list' ? 'active' : ''} onClick={() => changeView('list')}>列表</button><button type="button" className={viewMode === 'card' ? 'active' : ''} onClick={() => changeView('card')}>卡片</button></div></div>
      <form className="filter-grid v11-filter-grid" onSubmit={submit}>
        <Field label="搜索"><input name="search" defaultValue={values.search} placeholder="标题、品牌、产品或平台" /></Field>
        <Field label="状态"><select name="status" defaultValue={values.status}><option value="">全部状态</option>{Object.entries(videoStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="平台"><input name="platform" defaultValue={values.platform} /></Field>
        <Field label="视频类型"><select name="videoType" defaultValue={values.videoType}><option value="">全部类型</option><option value="product_card">商品卡</option><option value="qianchuan_ad">千川投放</option><option value="live_room_traffic">直播引流</option><option value="organic">自然流</option><option value="brand_seeding">品牌种草</option><option value="other">其他</option></select></Field>
        <Field label="内容等级"><select name="contentRating" defaultValue={values.contentRating}><option value="">全部等级</option>{['A+', 'A', 'B', 'B-', 'C', 'D'].map((value) => <option key={value}>{value}</option>)}</select></Field>
        <Field label="上传月份"><input name="month" type="month" defaultValue={values.month} /></Field>
        <Field label="开始日期"><input name="dateFrom" type="date" defaultValue={values.dateFrom} /></Field>
        <Field label="结束日期"><input name="dateTo" type="date" defaultValue={values.dateTo} /></Field>
        {user?.role === 'admin' ? <Field label="上传账号 ID"><input name="creatorId" defaultValue={values.creatorId} /></Field> : null}
        <button className="button secondary" type="submit">筛选</button>
      </form>
      {error ? <div className="error-state" role="alert"><p>{error}</p><button className="button secondary" type="button" onClick={() => router.refresh()}>重试</button></div> : null}
      {loading ? <p className="muted" role="status">正在加载视频…</p> : null}
      {!loading && !error && result.items.length === 0 ? <div className="empty-state"><p>没有符合条件的视频。</p><Link className="text-link" href="/videos/new">上传第一个视频</Link></div> : null}
      {result.items.length && viewMode === 'list' ? <VideoTable videos={result.items} showCreator={user?.role === 'admin'} /> : null}
      {result.items.length && viewMode === 'card' ? <div className="video-card-grid">{result.items.map((video) => <VideoCard key={video.id} video={video} showCreator={user?.role === 'admin'} />)}</div> : null}
      <div className="pagination"><span>共 {result.total} 条 · 第 {result.page}/{totalPages} 页</span><div><button className="button secondary" type="button" disabled={result.page <= 1 || loading} onClick={() => go(result.page - 1)}>上一页</button><button className="button secondary" type="button" disabled={result.page >= totalPages || loading} onClick={() => go(result.page + 1)}>下一页</button></div></div>
    </section>
  </main>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="form-field"><span>{label}</span>{children}</label>; }
function summary(video: Video) { const group = video.v11EvaluationGroups?.[0], comprehensive = video.v11ComprehensiveDecisions?.[0]; return { group, content: group?.decision?.contentRating || '—', score: group?.decision?.totalScore ?? '—', data: video.v11DataDecisions?.[0]?.dataRating || video.aiResultReviews?.[0]?.dataGrade || '—', comprehensive: comprehensive?.comprehensiveRating || video.finalVideoEvaluations?.[0]?.finalGrade || '—', hold: Boolean(group?.holds?.length), appeal: Boolean(group?.appeals?.length), revision: group?.workflowRevision?.revision || 0, source: comprehensive?.decisionSource || group?.decision?.decisionSource || '—' }; }
function VideoTable({ videos, showCreator }: { videos: Video[]; showCreator: boolean }) { return <div className="table-scroll" tabIndex={0} aria-label="视频列表，可横向滚动"><table><thead><tr><th>标题</th>{showCreator ? <th>上传账号</th> : null}<th>内容分 / 等级</th><th>数据 / 综合</th><th>工作流</th><th>Hold / 异议</th><th>提交时间</th></tr></thead><tbody>{videos.map((video) => { const state = summary(video); return <tr key={video.id}><td><Link className="text-link" href={`/videos/${video.id}`}>{video.title}</Link>{video.isTrial ? <span className="trial-badge">试用</span> : null}<small className="cell-subline">{video.brand || '—'} / {video.product || '—'}</small></td>{showCreator ? <td>{video.creator?.name || '—'}</td> : null}<td>{state.score} / {state.content}</td><td>{state.data} / {state.comprehensive}</td><td><span className="status">{displayLabel(videoStatusLabels, video.status)}</span><small className="cell-subline">Revision {state.revision} · {state.source}</small></td><td>{state.hold ? 'Hold' : '—'} / {state.appeal ? '有异议' : '—'}</td><td>{formatTime(video.createdAt)}</td></tr>; })}</tbody></table></div>; }
function VideoCard({ video, showCreator }: { video: Video; showCreator: boolean }) { const state = summary(video); return <article className="video-card"><div className="video-card-cover" style={video.coverUrl ? { backgroundImage: `url(${video.coverUrl})` } : undefined}>{video.coverUrl ? null : <span>暂无封面</span>}</div><div className="video-card-body"><div><Link className="text-link" href={`/videos/${video.id}`}>{video.title}</Link><p className="muted">{video.brand || '—'} · {video.product || '—'}</p></div><dl><div><dt>内容</dt><dd>{state.score} / {state.content}</dd></div><div><dt>数据</dt><dd>{state.data}</dd></div><div><dt>综合</dt><dd>{state.comprehensive}</dd></div><div><dt>状态</dt><dd>{displayLabel(videoStatusLabels, video.status)}</dd></div><div><dt>复核</dt><dd>{state.hold ? 'Hold' : state.appeal ? '异议中' : `R${state.revision}`}</dd></div><div><dt>下一步</dt><dd>{state.group?.status || '等待评估'}</dd></div></dl>{showCreator ? <small>上传账号：{video.creator?.name || '—'}</small> : null}<small>{formatTime(video.createdAt)}</small></div></article>; }
function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
