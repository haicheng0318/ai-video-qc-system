'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiBaseUrl, apiFetch, getToken } from '@/lib/api';

type VideoDetail = {
  id: string;
  title: string;
  brand?: string;
  product?: string;
  platform?: string;
  videoType: string;
  status: string;
  scriptDescription?: string;
  isForAds: boolean;
  isEventVideo: boolean;
  eventName?: string;
  createdAt: string;
  creator?: {
    name: string;
    account: string;
  };
  aiContentReviews?: unknown[];
  supervisorReviews?: unknown[];
  resultMetrics?: unknown[];
  aiResultReviews?: unknown[];
  ruleEngineResults?: unknown[];
  finalVideoEvaluations?: unknown[];
  operationLogs?: Array<{ id: string; actionType: string; createdAt: string; comment?: string }>;
};

export default function VideoDetailPage({ params }: { params: { id: string } }) {
  const [video, setVideo] = useState<VideoDetail | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<VideoDetail>(`/api/videos/${params.id}`)
      .then((result) => setVideo(result))
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'));
  }, [params.id]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    fetch(`${apiBaseUrl}/api/videos/${params.id}/file`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then((response) => {
        if (!response.ok) throw new Error('视频文件加载失败');
        return response.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        setVideoUrl(url);
        return () => URL.revokeObjectURL(url);
      })
      .catch((err) => setError(err instanceof Error ? err.message : '视频文件加载失败'));
  }, [params.id]);

  if (error) {
    return (
      <main className="page">
        <p className="error">{error}</p>
      </main>
    );
  }

  if (!video) {
    return (
      <main className="page">
        <p className="muted">加载中</p>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-title">
        <div>
          <h1>{video.title}</h1>
          <p className="muted">
            {video.creator?.name || '-'} · {new Date(video.createdAt).toLocaleString()}
          </p>
        </div>
        <Link className="button secondary" href="/videos">
          返回列表
        </Link>
      </div>
      <div className="detail-grid">
        <section className="panel">
          {videoUrl ? <video src={videoUrl} controls /> : <p className="muted">视频加载中</p>}
        </section>
        <aside className="panel">
          <h2>基础信息</h2>
          <p>状态：{video.status}</p>
          <p>视频类型：{video.videoType}</p>
          <p>品牌：{video.brand || '-'}</p>
          <p>产品：{video.product || '-'}</p>
          <p>平台：{video.platform || '-'}</p>
          <p>用于投放：{video.isForAds ? '是' : '否'}</p>
          <p>节点视频：{video.isEventVideo ? '是' : '否'}</p>
          <p>节点名称：{video.eventName || '-'}</p>
        </aside>
      </div>
      <section className="panel" style={{ marginTop: 20 }}>
        <h2>AI 与评定模块预留</h2>
        <p className="muted">Gemini 内容评估、GPT 数据复盘、规则引擎、最终评定将在后续阶段接入。</p>
        <p>Gemini 内容评估记录：{video.aiContentReviews?.length || 0}</p>
        <p>主管初审记录：{video.supervisorReviews?.length || 0}</p>
        <p>运营/投放数据记录：{video.resultMetrics?.length || 0}</p>
        <p>GPT 数据复盘记录：{video.aiResultReviews?.length || 0}</p>
        <p>规则引擎记录：{video.ruleEngineResults?.length || 0}</p>
        <p>最终评定记录：{video.finalVideoEvaluations?.length || 0}</p>
      </section>
      <section className="panel" style={{ marginTop: 20 }}>
        <h2>操作日志</h2>
        <table className="table">
          <thead>
            <tr>
              <th>动作</th>
              <th>说明</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {(video.operationLogs || []).map((log) => (
              <tr key={log.id}>
                <td>{log.actionType}</td>
                <td>{log.comment || '-'}</td>
                <td>{new Date(log.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
