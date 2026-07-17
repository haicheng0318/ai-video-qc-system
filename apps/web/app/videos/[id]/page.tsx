'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiBaseUrl, apiFetch, getToken } from '@/lib/api';
import { loadVideoDetailRequests } from '@/lib/video-detail-loader';

type ContentReviewScore = {
  id: string;
  dimension: string;
  score: number;
  maxScore: number;
  comment?: string | null;
};

type ContentReview = {
  id: string;
  modelProvider: string;
  modelName: string;
  contentSummary?: string | null;
  totalScore?: number | null;
  contentGrade?: string | null;
  isPublishableRecommendation?: boolean | null;
  mainProblems?: Array<{ dimension: string; description: string; timestamp?: string | null; severity: string }> | null;
  revisionSuggestions?: Array<{ problem: string; suggestion: string; priority: string }> | null;
  complianceRisks?: Array<{ riskType: string; description: string; timestamp?: string | null }> | null;
  usableScenarios?: string[] | null;
  status: string;
  errorMessage?: string | null;
  createdAt: string;
  scores: ContentReviewScore[];
};

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

const reviewStatusLabels: Record<string, string> = {
  pending: '未评估',
  running: '评估中',
  succeeded: '评估成功',
  failed: '评估失败',
};

const videoStatusLabels: Record<string, string> = {
  submitted: '待评估',
  ai_content_reviewing: '内容评估中',
  ai_content_failed: '内容评估失败',
  pending_supervisor_review: '等待主管初审',
};

export default function VideoDetailPage({ params }: { params: { id: string } }) {
  const [video, setVideo] = useState<VideoDetail | null>(null);
  const [contentReview, setContentReview] = useState<ContentReview | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [error, setError] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [latestError, setLatestError] = useState('');

  const loadVideo = useCallback(async () => {
    setLatestError('');
    await loadVideoDetailRequests({
      loadDetail: () => apiFetch<VideoDetail>(`/api/videos/${params.id}`),
      loadLatest: () => apiFetch<{ review: ContentReview | null }>(`/api/videos/${params.id}/content-review/latest`),
      onDetail: setVideo,
      onLatest: (latest) => setContentReview(latest.review),
      onLatestError: () => setLatestError('评估结果暂时不可用，请稍后重试。'),
    });
  }, [params.id]);

  useEffect(() => {
    loadVideo().catch((err) => setError(err instanceof Error ? err.message : '加载失败'));
  }, [loadVideo]);

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
      })
      .catch((err) => setError(err instanceof Error ? err.message : '视频文件加载失败'));
  }, [params.id]);

  async function triggerContentReview() {
    setReviewLoading(true);
    setReviewError('');
    try {
      await apiFetch(`/api/videos/${params.id}/content-review`, { method: 'POST' });
      await loadVideo();
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : '内容评估失败');
      await loadVideo().catch(() => undefined);
    } finally {
      setReviewLoading(false);
    }
  }

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

  const canTriggerReview = video.status === 'submitted' || video.status === 'ai_content_failed';

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
          <p>状态：{videoStatusLabels[video.status] || video.status}</p>
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
        <div className="page-title">
          <div>
            <h2>Gemini 内容评估</h2>
            <p className="muted">
              {contentReview ? reviewStatusLabels[contentReview.status] || contentReview.status : '未评估'}
            </p>
          </div>
          {canTriggerReview ? (
            <button className="button" type="button" onClick={triggerContentReview} disabled={reviewLoading}>
              {reviewLoading ? '评估中...' : '触发内容评估'}
            </button>
          ) : null}
        </div>
        {reviewError ? <p className="error">{reviewError}</p> : null}
        {latestError ? <p className="error">{latestError}</p> : null}
        {contentReview?.status === 'failed' ? <p className="error">{contentReview.errorMessage || '内容评估失败，请稍后重试。'}</p> : null}
        {contentReview?.status === 'succeeded' ? (
          <div>
            <p>内容总分：{contentReview.totalScore ?? '-'}</p>
            <p>内容等级：{contentReview.contentGrade || '-'}</p>
            <p>建议发布：{contentReview.isPublishableRecommendation ? '是' : '否'}</p>
            <p>内容摘要：{contentReview.contentSummary || '-'}</p>
            <h3>维度评分</h3>
            <ul>
              {contentReview.scores.map((score) => (
                <li key={score.id}>{score.dimension}：{score.score}/{score.maxScore}，{score.comment || '-'}</li>
              ))}
            </ul>
            <h3>主要问题</h3>
            <ul>
              {(contentReview.mainProblems || []).map((problem, index) => (
                <li key={`${problem.dimension}-${index}`}>{problem.dimension}：{problem.description}（{problem.severity}）</li>
              ))}
            </ul>
            <h3>修改建议</h3>
            <ul>
              {(contentReview.revisionSuggestions || []).map((suggestion, index) => (
                <li key={`${suggestion.problem}-${index}`}>{suggestion.problem}：{suggestion.suggestion}（{suggestion.priority}）</li>
              ))}
            </ul>
            <h3>合规风险</h3>
            <ul>
              {(contentReview.complianceRisks || []).map((risk, index) => (
                <li key={`${risk.riskType}-${index}`}>{risk.riskType}：{risk.description}</li>
              ))}
            </ul>
            <h3>可使用场景</h3>
            <p>{(contentReview.usableScenarios || []).join('、') || '-'}</p>
          </div>
        ) : null}
      </section>
      <section className="panel" style={{ marginTop: 20 }}>
        <h2>后续模块</h2>
        <p className="muted">主管初审、运营/投放数据、GPT 数据复盘、规则引擎和最终评定将在后续阶段接入。</p>
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
