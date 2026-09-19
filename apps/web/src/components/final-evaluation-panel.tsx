'use client';

import React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FINAL_EVALUATION_VERSION,
  FinalEvaluationHistoryResponse,
  FinalEvaluationLatestResponse,
  FinalEvaluationView,
  RuleEngineLatestResponse,
} from '@ai-video-qc/shared';
import { apiFetch, ApiUser } from '@/lib/api';
import {
  canTriggerFinalEvaluation,
  finalEvaluationErrorMessage,
  loadFinalEvaluationRequests,
  startFinalEvaluationJobPolling,
  triggerFinalEvaluation,
} from '@/lib/final-evaluation-ui';
import {
  attributionTypeLabels,
  boundaryLabels,
  displayLabel,
  evidenceSourceLabels,
  finalGradeLabels,
  finalStatusLabels,
  reviewStatusLabels,
  riskFlagLabels,
  ruleResultLabels,
  videoStatusLabels,
  userFacingErrorMessage,
} from '@/lib/display-labels';
import { shouldApplyLatestSelection, workflowEvidenceKey } from '@/lib/workflow-refresh';
import { formatShanghaiDateTime } from '@/lib/display-time';

const emptyHistory: FinalEvaluationHistoryResponse = { items: [], nextCursor: null };
function recordText(value: Record<string, unknown>, key: string) {
  return typeof value[key] === 'string' ? value[key] as string : '-';
}

function EvaluationDetails({ evaluation }: { evaluation: FinalEvaluationView }) {
  return (
    <div className="review-result">
      <p>建议等级：{evaluation.recommendedFinalGrade ? `建议${displayLabel(finalGradeLabels, evaluation.recommendedFinalGrade)}` : '-'}</p>
      <p>建议状态：{displayLabel(finalStatusLabels, evaluation.recommendedFinalStatus)}</p>
      <p>建议有效性：{evaluation.recommendedIsEffective === null ? '-' : evaluation.recommendedIsEffective ? '建议有效' : '建议无效'}</p>
      <p>建议置信度：{evaluation.recommendationConfidence ?? '-'}{evaluation.recommendationConfidence !== null ? '%' : ''}</p>
      <p>决策摘要：{evaluation.decisionSummary || '-'}</p>
      <h3>证据评估</h3>
      <ul>{evaluation.evidenceAssessment.map((item, index) => (
        <li key={`${recordText(item, 'source')}-${index}`}>{displayLabel(evidenceSourceLabels, recordText(item, 'source'))}：{recordText(item, 'conclusion')}</li>
      ))}</ul>
      <h3>最终归因建议</h3>
      <ul>{evaluation.finalAttribution.map((item, index) => (
        <li key={`${recordText(item, 'type')}-${index}`}>{displayLabel(attributionTypeLabels, recordText(item, 'type'))}：{recordText(item, 'conclusion')}</li>
      ))}</ul>
      <p>优化建议：{evaluation.finalSuggestion || '-'}</p>
      <h3>负责人确认重点</h3>
      <ul>{evaluation.confirmationFocus.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
      <h3>风险提示</h3>
      <ul>{evaluation.riskFlags.map((item, index) => (
        <li key={`${recordText(item, 'code')}-${index}`}>{displayLabel(riskFlagLabels, recordText(item, 'code'))}：{recordText(item, 'description')}</li>
      ))}</ul>
      <p>来源内容评估：{evaluation.contentReviewId}</p>
      <p>来源数据复盘：{evaluation.resultReviewId}</p>
      <p>来源规则结果：{evaluation.ruleEngineResultId}</p>
      <p>建议版本：{evaluation.evaluationVersion}</p>
    </div>
  );
}

export function FinalEvaluationPanel({ videoId, videoStatus, currentUser, onVideoRefresh, allowedActions }: {
  videoId: string;
  videoStatus: string;
  currentUser: ApiUser | null;
  onVideoRefresh: () => Promise<void>;
  allowedActions?: string[];
}) {
  const [rule, setRule] = useState<RuleEngineLatestResponse['ruleEngineResult']>(null);
  const [latest, setLatest] = useState<FinalEvaluationView | null>(null);
  const [history, setHistory] = useState<FinalEvaluationHistoryResponse>(emptyHistory);
  const [errors, setErrors] = useState({ rule: '', latest: '', history: '', action: '' });
  const [loading, setLoading] = useState({ rule: true, latest: true, history: true });
  const [submitting, setSubmitting] = useState(false);
  const [trackedJob, setTrackedJob] = useState<{ jobId: string; evaluationId: string } | null>(null);
  const [pollPause, setPollPause] = useState<string | null>(null);
  const [pollAttempt, setPollAttempt] = useState(0);
  const generation = useRef(0);
  const pinnedEvaluationId = useRef<string | null>(null);
  const evidenceKey = workflowEvidenceKey(videoStatus, allowedActions);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setErrors({ rule: '', latest: '', history: '', action: '' });
    setLoading({ rule: true, latest: true, history: true });
    await loadFinalEvaluationRequests({
      loadRule: () => apiFetch(`/api/videos/${videoId}/rule-engine/latest`),
      loadLatest: () => apiFetch(`/api/videos/${videoId}/final-evaluation/latest`),
      loadHistory: () => apiFetch(`/api/videos/${videoId}/final-evaluations/history?limit=20`),
      onRule: (value) => { if (current === generation.current) { setRule(value.ruleEngineResult); setLoading((state) => ({ ...state, rule: false })); } },
      onLatest: (value) => { if (current === generation.current) {
        if (shouldApplyLatestSelection(pinnedEvaluationId.current, value.evaluation?.id)) setLatest(value.evaluation);
        if (!pinnedEvaluationId.current && value.jobId && value.evaluation && ['pending', 'running'].includes(value.evaluation.status)) {
          pinnedEvaluationId.current = value.evaluation.id;
          setTrackedJob({ jobId: value.jobId, evaluationId: value.evaluation.id });
        }
        setLoading((state) => ({ ...state, latest: false }));
      } },
      onHistory: (value) => { if (current === generation.current) { setHistory(value); setLoading((state) => ({ ...state, history: false })); } },
      onRuleError: () => { if (current === generation.current) { setErrors((state) => ({ ...state, rule: '规则来源暂时不可用。' })); setLoading((state) => ({ ...state, rule: false })); } },
      onLatestError: () => { if (current === generation.current) { setErrors((state) => ({ ...state, latest: '最终评定建议暂时不可用。' })); setLoading((state) => ({ ...state, latest: false })); } },
      onHistoryError: () => { if (current === generation.current) { setErrors((state) => ({ ...state, history: '最终评定历史暂时不可用。' })); setLoading((state) => ({ ...state, history: false })); } },
    });
  }, [videoId]);

  useEffect(() => {
    pinnedEvaluationId.current = null;
    setTrackedJob(null);
    setRule(null); setLatest(null); setHistory(emptyHistory);
  }, [videoId]);

  useEffect(() => {
    let active = true;
    load().catch(() => { if (active) setErrors((state) => ({ ...state, latest: '最终评定建议暂时不可用。' })); });
    return () => { active = false; generation.current += 1; };
  }, [evidenceKey, load]);

  useEffect(() => {
    if (!trackedJob) return;
    setPollPause(null);
    return startFinalEvaluationJobPolling({
      videoId, ...trackedJob, request: apiFetch,
      onEvaluation: async (value) => {
        if (value.evaluation?.id === pinnedEvaluationId.current) setLatest(value.evaluation);
        setTrackedJob(null);
        await onVideoRefresh();
      },
      onPause: setPollPause,
      onError: () => setErrors((state) => ({ ...state, latest: '任务状态查询暂时失败，后台任务不受影响。' })),
    });
  }, [load, onVideoRefresh, pollAttempt, trackedJob, videoId]);

  const canTrigger = useMemo(
    () => allowedActions ? allowedActions.includes('trigger_final_evaluation') : canTriggerFinalEvaluation(currentUser, videoStatus, rule, latest),
    [allowedActions, currentUser, latest, rule, videoStatus],
  );

  async function trigger() {
    if (!rule || submitting) return;
    setSubmitting(true);
    try {
      const started = await triggerFinalEvaluation(apiFetch, videoId, rule.id);
      pinnedEvaluationId.current = started.evaluationId;
      if (started.jobId) setTrackedJob({ jobId: started.jobId, evaluationId: started.evaluationId });
      setLatest({
        id: started.evaluationId, contentReviewId: rule.contentReviewId, resultReviewId: rule.resultReviewId,
        ruleEngineResultId: rule.id, evaluationVersion: FINAL_EVALUATION_VERSION, modelProvider: 'aliyun_bailian', modelName: '',
        contentGrade: rule.contentGrade, dataGrade: rule.dataGrade || '', recommendedFinalGrade: null,
        recommendedFinalStatus: null, recommendedIsEffective: null, recommendationConfidence: null,
        decisionSummary: null, evidenceAssessment: [], finalAttribution: [], finalSuggestion: null,
        confirmationFocus: [], riskFlags: [], status: 'running', errorMessage: null,
        createdAt: new Date().toISOString(), completedAt: null, finalGrade: null, finalStatus: null,
        isEffectiveFinal: null, canBeUsedForPerformance: false, confirmedBy: null, confirmedAt: null,
        manualAdjustReason: null, confirmationComment: null, isExcellentCase: false,
        isNegativeCase: false, caseMarkedAt: null, caseNote: null,
      });
      await onVideoRefresh();
    } catch (error) {
      setErrors((state) => ({ ...state, action: finalEvaluationErrorMessage(error) }));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel section-gap final-evaluation-suggestion">
      <div className="page-title">
        <div><h2>千问最终评定建议</h2><p className="muted">基于已确定的内容、数据复盘和规则候选边界生成。</p></div>
        {canTrigger ? <button className="button" type="button" disabled={submitting} onClick={trigger}>
          {submitting ? '提交中' : videoStatus === 'final_evaluation_failed' ? '重新生成建议' : '生成千问最终评定建议'}
        </button> : null}
      </div>
      <p>当前视频状态：{displayLabel(videoStatusLabels, videoStatus)}</p>
      <p className="warning-list">千问建议不是最终业务结论。负责人确认后，视频才会进入正式最终状态。</p>
      {loading.rule ? <p className="muted">正在读取规则候选来源。</p> : rule ? (
        <p>规则候选：{displayLabel(ruleResultLabels, rule.ruleResult)}；硬边界：{displayLabel(boundaryLabels, rule.recommendedBoundary)}；版本：{rule.ruleVersion}</p>
      ) : <p className="muted">暂无可用规则候选。</p>}
      {loading.latest ? <p className="muted">正在读取最新建议。</p> : null}
      {latest?.status === 'running' ? <p className="muted">千问正在基于内容、数据和规则边界生成最终评定建议。</p> : null}
      {pollPause ? <p className="warning-list" role="status">自动查询已暂停（{pollPause === 'timeout' ? '达到查询时限' : '网络不稳定'}），不代表后台任务失败。 <button className="button secondary" type="button" onClick={() => setPollAttempt((value) => value + 1)}>恢复查询</button></p> : null}
      {latest?.status === 'failed' ? <p className="error">{userFacingErrorMessage(latest.errorMessage, '千问最终建议生成失败，可重新触发。')}</p> : null}
      {latest?.status === 'succeeded' ? <EvaluationDetails evaluation={latest} /> : null}
      {videoStatus === 'pending_final_confirmation' ? <p className="warning-list">当前仅为千问建议，尚未完成负责人确认。</p> : null}
      {Object.values(errors).filter(Boolean).map((error, index) => <p className="error" key={`${error}-${index}`}>{error}</p>)}
      <h3>历史评定建议</h3>
      {loading.history ? <p className="muted">正在读取历史。</p> : history.items.length === 0 ? <p className="muted">暂无历史建议。</p> : (
        <div className="table-scroll"><table className="table"><thead><tr><th>状态</th><th>建议等级</th><th>置信度</th><th>来源规则</th><th>时间</th></tr></thead><tbody>
          {history.items.map((item) => <tr key={item.id}><td>{displayLabel(reviewStatusLabels, item.status)}{item.isLatest ? '（最新）' : ''}</td><td>{item.recommendedFinalGrade ? `建议${displayLabel(finalGradeLabels, item.recommendedFinalGrade)}` : '-'}</td><td>{item.recommendationConfidence ?? '-'}%</td><td>{item.ruleEngineResultId}</td><td>{formatShanghaiDateTime(item.createdAt)}</td></tr>)}
        </tbody></table></div>
      )}
    </section>
  );
}
