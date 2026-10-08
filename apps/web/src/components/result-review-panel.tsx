'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  startResultReviewJobPolling,
  triggerResultReview,
} from '@/lib/result-review-ui';
import {
  attributionTypeLabels,
  displayLabel,
  metricConceptLabel,
  reviewStatusLabels,
  severityLabels,
  userFacingErrorMessage,
} from '@/lib/display-labels';
import {
  canApplySourceResponse,
  latestMetricForTrigger,
  shouldApplyLatestSelection,
  workflowEvidenceKey,
} from '@/lib/workflow-refresh';
import { formatShanghaiDateTime } from '@/lib/display-time';

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
  allowedActions,
  latestResultMetricId,
}: {
  videoId: string;
  videoType: VideoType;
  isForAds: boolean;
  videoStatus: string;
  currentUser: ApiUser | null;
  onVideoRefresh: () => Promise<void>;
  allowedActions?: string[];
  latestResultMetricId?: string | null;
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
  const [trackedJob, setTrackedJob] = useState<{ jobId: string; reviewId: string } | null>(null);
  const [pollPause, setPollPause] = useState<string | null>(null);
  const [pollAttempt, setPollAttempt] = useState(0);
  const pinnedReviewId = useRef<string | null>(null);
  const requestGeneration = useRef(0);
  const sourceRequest = useRef<AbortController | null>(null);
  const evidenceKey = workflowEvidenceKey(videoStatus, allowedActions, [latestResultMetricId]);

  const load = useCallback(async () => {
    sourceRequest.current?.abort();
    const controller = new AbortController();
    sourceRequest.current = controller;
    const generation = ++requestGeneration.current;
    const isCurrent = () => generation === requestGeneration.current && !controller.signal.aborted;
    setMetricError('');
    setLatestError('');
    setHistoryError('');
    try {
      await loadResultReviewRequests({
        loadMetric: () => apiFetch(`/api/videos/${videoId}/result-metrics/latest`, { signal: controller.signal }),
        loadLatest: () => apiFetch(`/api/videos/${videoId}/result-review/latest`, { signal: controller.signal }),
        loadHistory: () => apiFetch(`/api/videos/${videoId}/result-reviews/history?limit=20`, { signal: controller.signal }),
        onMetric: (value) => {
          if (canApplySourceResponse(generation, requestGeneration.current, value?.id, latestResultMetricId)) setLatestMetric(value);
          else if (isCurrent()) setMetricError('最新快照来源正在同步，请稍后重试。');
        },
        onLatest: (value) => {
          if (!isCurrent()) return;
          if (shouldApplyLatestSelection(pinnedReviewId.current, value.review?.id)) setReview(value.review);
          if (!pinnedReviewId.current && value.jobId && value.review && ['pending', 'running'].includes(value.review.status)) {
            pinnedReviewId.current = value.review.id;
            setTrackedJob({ jobId: value.jobId, reviewId: value.review.id });
          }
        },
        onHistory: (value) => { if (isCurrent()) setHistory(value); },
        onMetricError: () => { if (isCurrent()) setMetricError('最新结果数据暂时不可用。'); },
        onLatestError: () => { if (isCurrent()) setLatestError('千问复盘结果暂时不可用。'); },
        onHistoryError: () => { if (isCurrent()) setHistoryError('千问复盘历史暂时不可用。'); },
      });
    } finally {
      if (sourceRequest.current === controller) sourceRequest.current = null;
    }
  }, [latestResultMetricId, videoId]);

  useEffect(() => {
    pinnedReviewId.current = null;
    setTrackedJob(null);
    setLatestMetric(null);
    setReview(null);
    setHistory(emptyHistory);
  }, [videoId]);

  useEffect(() => {
    void load();
    return () => {
      sourceRequest.current?.abort();
      requestGeneration.current += 1;
    };
  }, [evidenceKey, load]);

  useEffect(() => {
    if (!trackedJob) {
      setPolling(false);
      return;
    }
    setPolling(true);
    setPollPause(null);
    return startResultReviewJobPolling({
      videoId, ...trackedJob, request: apiFetch,
      onReview: async (value) => {
        if (value.review?.id === pinnedReviewId.current) setReview(value.review);
        setTrackedJob(null);
        setPolling(false);
        await onVideoRefresh();
      },
      onPause: setPollPause,
      onError: () => setLatestError('任务状态查询暂时失败，后台任务不受影响。'),
    });
  }, [load, onVideoRefresh, pollAttempt, trackedJob, videoId]);

  const canTrigger = useMemo(
    () => allowedActions ? allowedActions.includes('trigger_result_review') : canTriggerResultReview(currentUser, videoType, isForAds, videoStatus, latestMetric, review),
    [allowedActions, currentUser, videoType, isForAds, videoStatus, latestMetric, review],
  );

  async function trigger() {
    if (submitting) return;
    const currentMetric = latestMetricForTrigger(latestMetric, latestResultMetricId);
    if (!currentMetric) {
      setActionError('最新快照来源尚未同步，已重新查询，请稍后再试。');
      await load();
      return;
    }
    setSubmitting(true);
    setActionError('');
    try {
      const started = await triggerResultReview(apiFetch, videoId, currentMetric.id);
      pinnedReviewId.current = started.reviewId;
      setTrackedJob({ jobId: started.jobId, reviewId: started.reviewId });
      setReview({
        id: started.reviewId,
        resultMetricId: started.resultMetricId,
        modelProvider: 'aliyun_bailian',
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
          <h2>千问数据复盘</h2>
          <p className="muted">
            {latestMetric
              ? `数据周期：${latestMetric.dataStartDate || '-'} 至 ${latestMetric.dataEndDate || '-'}`
              : '尚无可复盘的数据快照'}
          </p>
        </div>
        {canTrigger ? (
          <button className="button" type="button" disabled={submitting} onClick={trigger}>
            {submitting ? '提交中' : videoStatus === 'ai_result_failed' ? '重新触发数据复盘' : '开始千问数据复盘'}
          </button>
        ) : null}
      </div>

      <p>当前状态：{review ? displayLabel(reviewStatusLabels, review.status) : '未复盘'}</p>
      <p>绑定快照：{review?.resultMetricId || latestMetric?.id || '-'}</p>
      {review?.modelName ? <p>使用模型：{review.modelName}</p> : null}
      {review?.status === 'running' || polling ? <p className="muted">千问正在复盘运营/投放数据。</p> : null}
      {pollPause ? <p className="warning-list" role="status">自动查询已暂停（{pollPause === 'timeout' ? '达到查询时限' : '网络不稳定'}），不代表后台任务失败。 <button className="button secondary" type="button" onClick={() => setPollAttempt((value) => value + 1)}>恢复查询</button></p> : null}
      {videoStatus === 'pending_rule_engine' ? <p className="muted">数据复盘已完成，等待后端规则判断。</p> : null}
      {review?.status === 'failed' ? (
        <p className="error">{userFacingErrorMessage(review.errorMessage, '千问数据复盘失败，请重新触发。')}</p>
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
          <p>业务有效性建议：{review.isBusinessEffectiveRecommendation ? '建议判定为业务有效' : '暂不建议判定为业务有效'}</p>
        </div>
      ) : null}
      {review?.status === 'succeeded' ? (
        <div>
          <p>结果摘要：{review.resultSummary || '-'}</p>
          <p>继续测试建议：{continuationLabels[review.continueTestRecommendation || ''] || '-'}</p>
          <h3>表现问题</h3>
          <ul>{review.performanceProblems.map((item, index) => <li key={`${item.metric}-${index}`}>{metricConceptLabel(item.metric)}（{displayLabel(severityLabels, item.severity)}）：{item.description}</li>)}</ul>
          <h3>归因分析</h3>
          <ul>{review.attributionAnalysis.map((item, index) => <li key={`${item.type}-${index}`}>{displayLabel(attributionTypeLabels, item.type)}（置信度 {item.confidence}%）：{item.conclusion}</li>)}</ul>
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
                  <td>{displayLabel(reviewStatusLabels, item.status)}{item.isLatest ? '（最新）' : ''}</td>
                  <td>{item.dataSufficiency === 'insufficient' ? '数据不足' : item.dataGrade || '-'}</td>
                  <td>{formatShanghaiDateTime(item.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
