'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { VideoType } from '@ai-video-qc/shared';
import { apiFetch, ApiUser } from '@/lib/api';
import { ResultMetricSnapshot } from '@/lib/result-metrics-ui';
import {
  canTriggerResultReview,
  loadResultReviewRequests,
  ResultReview,
  ResultReviewHistory,
  resultReviewErrorMessage,
  shouldDisplayResultScore,
  startResultReviewPolling,
  triggerResultReview,
} from '@/lib/result-review-ui';

const emptyHistory: ResultReviewHistory = { items: [], nextCursor: null };

const continuationLabels: Record<string, string> = {
  continue: '继续测试',
  optimize_then_continue: '优化后继续测试',
  pause: '暂停测试',
  collect_more_data: '补充更多数据',
};

export function ResultReviewPanel({
  videoId,
  videoType,
  isForAds,
  videoStatus,
  currentUser,
  onVideoRefresh,
}: {
  videoId: string;
  videoType: VideoType;
  isForAds: boolean;
  videoStatus: string;
  currentUser: ApiUser | null;
  onVideoRefresh: () => Promise<void>;
}) {
  const [latestMetric, setLatestMetric] = useState<ResultMetricSnapshot | null>(null);
  const [review, setReview] = useState<ResultReview | null>(null);
  const [history, setHistory] = useState<ResultReviewHistory>(emptyHistory);
  const [metricError, setMetricError] = useState('');
  const [latestError, setLatestError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [actionError, setActionError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);

  const load = useCallback(async () => {
    setMetricError('');
    setLatestError('');
    setHistoryError('');
    await loadResultReviewRequests({
      loadMetric: () => apiFetch(`/api/videos/${videoId}/result-metrics/latest`),
      loadLatest: () => apiFetch(`/api/videos/${videoId}/result-review/latest`),
      loadHistory: () => apiFetch(`/api/videos/${videoId}/result-reviews/history?limit=20`),
      onMetric: setLatestMetric,
      onLatest: (value) => setReview(value.review),
      onHistory: setHistory,
      onMetricError: () => setMetricError('最新结果数据暂时不可用。'),
      onLatestError: () => setLatestError('GPT 复盘结果暂时不可用。'),
      onHistoryError: () => setHistoryError('GPT 复盘历史暂时不可用。'),
    });
  }, [videoId]);

  useEffect(() => {
    setLatestMetric(null);
    setReview(null);
    setHistory(emptyHistory);
    load().catch(() => setLatestError('GPT 复盘结果暂时不可用。'));
  }, [load, videoId]);

  useEffect(() => {
    if (review?.status !== 'running' && videoStatus !== 'ai_result_reviewing') {
      setPolling(false);
      return;
    }
    setPolling(true);
    return startResultReviewPolling({
      loadLatest: () => apiFetch(`/api/videos/${videoId}/result-review/latest`),
      onLatest: (value) => setReview(value.review),
      onTerminal: async () => {
        setPolling(false);
        await load();
        await onVideoRefresh();
      },
      onError: () => setLatestError('轮询 GPT 复盘状态失败，正在有限重试。'),
    });
  }, [load, onVideoRefresh, review?.status, videoId, videoStatus]);

  const canTrigger = useMemo(
    () => canTriggerResultReview(currentUser, videoType, isForAds, videoStatus, latestMetric, review),
    [currentUser, videoType, isForAds, videoStatus, latestMetric, review],
  );

  async function trigger() {
    if (!latestMetric || submitting) return;
    setSubmitting(true);
    setActionError('');
    try {
      const started = await triggerResultReview(apiFetch, videoId, latestMetric.id);
      setReview({
        id: started.reviewId,
        resultMetricId: started.resultMetricId,
        modelProvider: 'openai',
        modelName: '',
        dataScore: null,
        dataGrade: null,
        dataSufficiency: 'pending',
        isBusinessEffectiveRecommendation: null,
        resultSummary: null,
        performanceProblems: [],
        attributionAnalysis: [],
        optimizationSuggestions: [],
        sufficiencyReasons: [],
        continueTestRecommendation: null,
        status: 'running',
        errorMessage: null,
        createdAt: new Date().toISOString(),
      });
      await onVideoRefresh();
    } catch (error) {
      setActionError(resultReviewErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel section-gap result-review">
      <div className="page-title">
        <div>
          <h2>GPT 数据复盘</h2>
          <p className="muted">
            {latestMetric
              ? `数据周期：${latestMetric.dataStartDate || '-'} 至 ${latestMetric.dataEndDate || '-'}`
              : '尚无可复盘的数据快照'}
          </p>
        </div>
        {canTrigger ? (
          <button className="button" type="button" disabled={submitting} onClick={trigger}>
            {submitting ? '提交中' : videoStatus === 'ai_result_failed' ? '重新触发数据复盘' : '开始 GPT 数据复盘'}
          </button>
        ) : null}
      </div>

      <p>当前状态：{review?.status || '未复盘'}</p>
      <p>绑定快照：{review?.resultMetricId || latestMetric?.id || '-'}</p>
      {review?.modelName ? <p>使用模型：{review.modelName}</p> : null}
      {review?.status === 'running' || polling ? <p className="muted">GPT 正在复盘运营/投放数据。</p> : null}
      {videoStatus === 'pending_rule_engine' ? <p className="muted">数据复盘已完成，等待后端规则判断。</p> : null}
      {review?.status === 'failed' ? (
        <p className="error">{review.errorMessage || '数据复盘失败，请重新触发。'}</p>
      ) : null}
      {review?.status === 'succeeded' && review.dataSufficiency === 'insufficient' ? (
        <div>
          <p className="warning">当前数据不足，等待补充更多结果数据。</p>
          <h3>数据不足原因</h3>
          <ul>
            {review.sufficiencyReasons.map((reason, index) => (
              <li key={`${reason.code}-${index}`}>{reason.description}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {shouldDisplayResultScore(review) ? (
        <div>
          <p>数据分数：{review.dataScore}</p>
          <p>数据等级：{review.dataGrade}</p>
          <p>数据侧建议：{review.isBusinessEffectiveRecommendation ? '具备继续测试价值' : '当前数据侧不建议继续'}</p>
        </div>
      ) : null}
      {review?.status === 'succeeded' ? (
        <div>
          <p>结果摘要：{review.resultSummary || '-'}</p>
          <p>继续测试建议：{continuationLabels[review.continueTestRecommendation || ''] || '-'}</p>
          <h3>表现问题</h3>
          <ul>{review.performanceProblems.map((item, index) => <li key={`${item.metric}-${index}`}>{item.metric}：{item.description}</li>)}</ul>
          <h3>归因分析</h3>
          <ul>{review.attributionAnalysis.map((item, index) => <li key={`${item.type}-${index}`}>{item.type}（置信度 {item.confidence}%）：{item.conclusion}</li>)}</ul>
          <h3>优化建议</h3>
          <ul>{review.optimizationSuggestions.map((item, index) => <li key={`${item.owner}-${index}`}>{item.action}：{item.rationale}</li>)}</ul>
        </div>
      ) : null}

      {metricError ? <p className="error">{metricError}</p> : null}
      {latestError ? <p className="error">{latestError}</p> : null}
      {historyError ? <p className="error">{historyError}</p> : null}
      {actionError ? <p className="error">{actionError}</p> : null}

      <h3>历史复盘记录</h3>
      {history.items.length === 0 ? <p className="muted">暂无历史复盘。</p> : (
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>数据周期</th><th>模型</th><th>状态</th><th>数据结论</th><th>时间</th></tr></thead>
            <tbody>
              {history.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.dataPeriod.start?.slice(0, 10) || '-'} 至 {item.dataPeriod.end?.slice(0, 10) || '-'}</td>
                  <td>{item.modelName}</td>
                  <td>{item.status}{item.isLatest ? '（最新）' : ''}</td>
                  <td>{item.dataSufficiency === 'insufficient' ? '数据不足' : item.dataGrade || '-'}</td>
                  <td>{new Date(item.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
