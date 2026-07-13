'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

type Video = {
  id: string;
  title: string;
  brand?: string;
  product?: string;
  platform?: string;
  videoType: string;
  status: string;
  createdAt: string;
  creator?: {
    name: string;
  };
};

export default function VideosPage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<{ items: Video[] }>('/api/videos')
      .then((result) => setVideos(result.items))
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'));
  }, []);

  return (
    <main className="page">
      <div className="page-title">
        <div>
          <h1>视频列表</h1>
          <p className="muted">第一阶段展示基础信息、状态和权限过滤结果。</p>
        </div>
        <Link className="button" href="/videos/new">
          上传视频
        </Link>
      </div>
      <div className="panel">
        {error && <p className="error">{error}</p>}
        <table className="table">
          <thead>
            <tr>
              <th>标题</th>
              <th>编导</th>
              <th>品牌 / 产品</th>
              <th>平台</th>
              <th>视频类型</th>
              <th>状态</th>
              <th>提交时间</th>
            </tr>
          </thead>
          <tbody>
            {videos.map((video) => (
              <tr key={video.id}>
                <td>
                  <Link href={`/videos/${video.id}`}>{video.title}</Link>
                </td>
                <td>{video.creator?.name || '-'}</td>
                <td>
                  {video.brand || '-'} / {video.product || '-'}
                </td>
                <td>{video.platform || '-'}</td>
                <td>{video.videoType}</td>
                <td>
                  <span className="status">{video.status}</span>
                </td>
                <td>{new Date(video.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {videos.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  暂无视频
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
