'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiBaseUrl, apiFetch } from '@/lib/api';

export function VideoPlayer({ videoId }: { videoId: string }) {
  const player = useRef<HTMLVideoElement>(null);
  const request = useRef<AbortController | undefined>(undefined);
  const blobUrl = useRef('');
  const restore = useRef<{ time: number; playing: boolean } | null>(null);
  const automaticRetries = useRef(0);
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (preservePosition = false) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 30_000);
    if (preservePosition && player.current) {
      restore.current = { time: player.current.currentTime, playing: !player.current.paused };
    }
    setLoading(true);
    setError('');
    try {
      const { url } = await apiFetch<{ url: string | null }>(`/api/videos/${videoId}/file-url`, {
        signal: controller.signal, cache: 'no-store',
      });
      let nextSource = url;
      if (!nextSource) {
        const response = await fetch(`${apiBaseUrl}/api/videos/${videoId}/file`, {
          credentials: 'include', signal: controller.signal,
        });
        if (!response.ok) throw new Error('视频文件加载失败');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        nextSource = URL.createObjectURL(blob);
      }
      if (controller.signal.aborted) return;
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
      blobUrl.current = nextSource.startsWith('blob:') ? nextSource : '';
      setSource(nextSource);
      // Even if an SDK returns the same signed URL, explicitly reload a failed resource.
      if (preservePosition && player.current) {
        player.current.src = nextSource;
        player.current.load();
      }
    } catch {
      if (request.current === controller) {
        setError('视频暂时无法加载，请检查网络后重试。不会影响评估结果。');
      }
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) setLoading(false);
    }
  }, [videoId]);

  useEffect(() => {
    void load();
    return () => {
      const active = request.current;
      request.current = undefined;
      active?.abort();
      if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    };
  }, [load]);

  function recover() {
    if (loading) return;
    if (automaticRetries.current < 1) {
      automaticRetries.current += 1;
      void load(true);
    } else {
      setError('视频播放失败，可能是网络、链接过期或编码不兼容。请重试加载。');
    }
  }

  return (
    <section className="panel video-player-panel" aria-label="视频预览">
      <div className="video-player-stage">
        {source ? <video ref={player} src={source} controls playsInline preload="metadata"
          onError={recover}
          onLoadedMetadata={() => {
            const video = player.current;
            const saved = restore.current;
            if (!video || !saved) return;
            restore.current = null;
            if (Number.isFinite(saved.time)) {
              video.currentTime = Math.max(0, Math.min(saved.time, Number.isFinite(video.duration) ? video.duration : saved.time));
            }
            if (saved.playing) void video.play().catch(() => undefined);
          }} /> : null}
      </div>
      <div aria-live="polite">
        {loading ? <p className="muted">正在加载视频……</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </div>
      {error ? <button className="button secondary" type="button" disabled={loading} onClick={() => {
        automaticRetries.current = 0;
        void load(true);
      }}>重新加载视频</button> : null}
      <p className="muted">保持原始比例显示 · 可使用播放器全屏查看</p>
    </section>
  );
}
