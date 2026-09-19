'use client';

import Link from 'next/link';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { displayLabel, videoStatusLabels, videoTypeLabels } from '@/lib/display-labels';

type Video = { id: string; title: string; brand?: string; product?: string; platform?: string; videoType: string; status: string; createdAt: string; isTrial?: boolean; creator?: { name: string } };
type VideoList = { items: Video[]; total?: number; page?: number; pageSize?: number };

export default function VideosPage() {
  return <Suspense fallback={<main className="page"><p className="muted">正在加载视频列表…</p></main>}><VideoListPage /></Suspense>;
}

function VideoListPage() {
  const router = useRouter(), params = useSearchParams();
  const [result, setResult] = useState<Required<VideoList>>({ items: [], total: 0, page: 1, pageSize: 20 });
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const search = params.get('search') || '', status = params.get('status') || '', platform = params.get('platform') || '', videoType = params.get('videoType') || '';
  const page = Math.max(1, Math.min(10000, Number(params.get('page')) || 1)), pageSize = 20;
  const queryString = new URLSearchParams({ ...(search ? { search } : {}), ...(status ? { status } : {}), ...(platform ? { platform } : {}), ...(videoType ? { videoType } : {}), page: String(page), pageSize: String(pageSize) }).toString();

  useEffect(() => {
    let active = true; setLoading(true); setError('');
    void apiFetch<VideoList>(`/api/videos?${queryString}`).then((data) => { if (active) setResult({ items: data.items, total: data.total ?? data.items.length, page: data.page ?? page, pageSize: data.pageSize ?? pageSize }); }).catch((err) => { if (active) setError(err instanceof Error ? err.message : '视频列表加载失败。'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [queryString, page]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget), next = new URLSearchParams();
    for (const name of ['search', 'status', 'platform', 'videoType']) { const value = String(data.get(name) || '').trim(); if (value) next.set(name, value); }
    next.set('page', '1'); router.push(`/videos?${next.toString()}`);
  }
  function go(nextPage: number) { const next = new URLSearchParams(params.toString()); next.set('page', String(nextPage)); router.push(`/videos?${next.toString()}`); }
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  return <main className="page" id="main-content"><div className="page-title"><div><p className="eyebrow">WORK QUEUE</p><h1>视频列表</h1><p className="muted">查看视频从提交、内容评估到最终确认的完整质检进度。</p></div><Link className="button" href="/videos/new">上传视频</Link></div><section className="panel"><form className="filter-grid" onSubmit={submit}><div className="form-field"><label htmlFor="video-search">搜索</label><input id="video-search" name="search" defaultValue={search} placeholder="标题、品牌、产品或平台" /></div><div className="form-field"><label htmlFor="video-status">状态</label><select id="video-status" name="status" defaultValue={status}><option value="">全部状态</option>{Object.entries(videoStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="form-field"><label htmlFor="video-platform">平台</label><input id="video-platform" name="platform" defaultValue={platform} /></div><div className="form-field"><label htmlFor="video-type">视频类型</label><select id="video-type" name="videoType" defaultValue={videoType}><option value="">全部类型</option>{Object.entries(videoTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><button className="button secondary" type="submit">筛选</button></form>{error ? <div className="error-state" role="alert"><p>{error}</p><button className="button secondary" type="button" onClick={() => router.refresh()}>重试</button></div> : null}{loading ? <p className="muted" role="status">正在加载视频…</p> : null}{!loading && !error && result.items.length === 0 ? <div className="empty-state"><p>没有符合条件的视频。</p><Link className="text-link" href="/videos/new">上传第一个视频</Link></div> : null}{result.items.length ? <div className="table-scroll" tabIndex={0} aria-label="视频列表，可横向滚动"><table><thead><tr><th>标题</th><th>编导</th><th>品牌 / 产品</th><th>平台</th><th>视频类型</th><th>状态</th><th>提交时间</th></tr></thead><tbody>{result.items.map((video) => <tr key={video.id}><td><Link className="text-link" href={`/videos/${video.id}`}>{video.title}</Link>{video.isTrial ? <span className="trial-badge">试用</span> : null}</td><td>{video.creator?.name || '—'}</td><td>{video.brand || '—'} / {video.product || '—'}</td><td>{video.platform || '—'}</td><td>{displayLabel(videoTypeLabels, video.videoType)}</td><td><span className="status">{displayLabel(videoStatusLabels, video.status)}</span></td><td>{new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(video.createdAt))}</td></tr>)}</tbody></table></div> : null}<div className="pagination"><span>共 {result.total} 条 · 第 {result.page}/{totalPages} 页</span><div><button className="button secondary" type="button" disabled={result.page <= 1 || loading} onClick={() => go(result.page - 1)}>上一页</button><button className="button secondary" type="button" disabled={result.page >= totalPages || loading} onClick={() => go(result.page + 1)}>下一页</button></div></div></section></main>;
}
