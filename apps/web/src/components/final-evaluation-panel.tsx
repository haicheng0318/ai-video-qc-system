'use client';

import React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
  startFinalEvaluationPolling,
  triggerFinalEvaluation,
} from '@/lib/final-evaluation-ui';

const emptyHistory: FinalEvaluationHistoryResponse = { items: [], nextCursor: null };
const gradeLabels: Record<string, string> = {
  effective: '建议有效', low_effective: '建议低有效', invalid: '建议无效',
};

function recordText(value: Record<string, unknown>, key: string) {
  return typeof value[key] === 'string' ? value[key] as string : '-';
}

function EvaluationDetails({ evaluation }: { evaluation: FinalEvaluationView }) {
  return (
    <div className="review-result">
      <p>建议等级：{evaluation.recommendedFinalGrade ? gradeLabels[evaluation.recommendedFinalGrade] : '-'}</p>
      <p>建议状态：{evaluation.recommendedFinalStatus || '-'}</p>
      <p>建议有效性：{evaluation.recommendedIsEffective === null ? '-' : evaluation.recommendedIsEffective ? '建议有效' : '建议无效'}</p>
      <p>建议置信度：{evaluation.recommendationConfidence ?? '-'}{evaluation.recommendationConfidence !== null ? '%' : ''}</p>
      <p>决策摘要：{evaluation.decisionSummary || '-'}</p>
      <h3>证据评估</h3>
      <ul>{evaluation.evidenceAssessment.map((item, index) => (
        <li key={`${recordText(item, 'source')}-${index}`}>{recordText(item, 'source')}：{recordText(item, 'conclusion')}</li>
      ))}</ul>
      <h3>最终归因建议</h3>
      <ul>{evaluation.finalAttribution.map((item, index) => (
        <li key={`${recordText(item, 'type')}-${index}`}>{recordText(item, 'type')}：{recordText(item, 'conclusion')}</li>
      ))}</ul>
      <p>优化建议：{evaluation.finalSuggestion || '-'}</p>
      <h3>负责人确认重点</h3>
      <ul>{evaluation.confirmationFocus.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
      <h3>风险提示</h3>
      <ul>{evaluation.riskFlags.map((item, index) => (
        <li key={`${recordText(item, 'code')}-${index}`}>{recordText(item, 'code')}：{recordText(item, 'description')}</li>
      ))}</ul>
      <p>来源内容评估：{evaluation.contentReviewId}</p>
      <p>来源数据复盘：{evaluation.resultReviewId}</p>
      <p>来源规则结果：{evaluation.ruleEngineResultId}</p>
      <p>建议版本：{evaluation.evaluationVersion}</p>
    </div>
  );
}

export function FinalEvaluationPanel({ videoId, videoStatus, currentUser, onVideoRefresh }: {
  videoId: string;
  videoStatus: string;
  currentUser: ApiUser | null;
  onVideoRefresh: () => Promise<void>;
}) {
  const [rule, setRule] = useState<RuleEngineLatestResponse['ruleEngineResult']>(null);
  const [latest, setLatest] = useState<FinalEvaluationView | null>(null);
  const [history, setHistory] = useState<FinalEvaluationHistoryResponse>(emptyHistory);
  const [errors, setErrors] = useState({ rule: '', latest: '', history: '', action: '' });
  const [loading, setLoading] = useState({ rule: true, latest: true, history: true });
  const [submitting, setSubmitting] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setErrors({ rule: '', latest: '', history: '', action: '' });
    setLoading({ rule: true, latest: true, history: true });
    await loadFinalEvaluationRequests({
      loadRule: () => apiFetch(`/api/videos/${videoId}/rule-engine/latest`),
      loadLatest: () => apiFetch(`/api/videos/${videoId}/final-evaluation/latest`),
      loadHistory: () => apiFetch(`/api/videos/${videoId}/final-evaluations/history?limit=20`),
      onRule: (value) => { if (current === generation.current) { setRule(value.ruleEngineResult); setLoading((state) => ({ ...state, rule: false })); } },
      onLatest: (value) => { if (current === generation.current) { setLatest(value.evaluation); setLoading((state) => ({ ...state, latest: false })); } },
      onHistory: (value) => { if (current === generation.current) { setHistory(value); setLoading((state) => ({ ...state, history: false })); } },
      onRuleError: () => { if (current === generation.current) { setErrors((state) => ({ ...state, rule: '规则来源暂时不可用。' })); setLoading((state) => ({ ...state, rule: false })); } },
      onLatestError: () => { if (current === generation.current) { setErrors((state) => ({ ...state, latest: '最终评定建议暂时不可用。' })); setLoading((state) => ({ ...state, latest: false })); } },
      onHistoryError: () => { if (current === generation.current) { setErrors((state) => ({ ...state, history: '最终评定历史暂时不可用。' })); setLoading((state) => ({ ...state, history: false })); } },
    });
  }, [videoId]);

  useEffect(() => {
    setRule(null); setLatest(null); setHistory(emptyHistory);
    let active = true;
    load().catch(() => { if (active) setErrors((state) => ({ ...state, latest: '最终评定建议暂时不可用。' })); });
    return () => { active = false; generation.current += 1; };
  }, [load, videoId]);

  useEffect(() => {
    if (latest?.status !== 'running') return;
    return startFinalEvaluationPolling({
      loadLatest: () => apiFetch(`/api/videos/${videoId}/final-evaluation/latest`),
      onLatest: (value) => setLatest(value.evaluation),
      onTerminal: async () => { await load(); await onVideoRefresh(); },
      onError: () => setErrors((state) => ({ ...state, latest: '轮询最终评定建议失败，正在有限重试。' })),
    });
  }, [latest?.status, load, onVideoRefresh, videoId]);

  const canTrigger = useMemo(
    () => canTriggerFinalEvaluation(currentUser, videoStatus, rule, latest),
    [currentUser, latest, rule, videoStatus],
  );

  async function trigger() {
    if (!rule || submitting) return;
    setSubmitting(true);
    try {
      const started = await triggerFinalEvaluation(apiFetch, videoId, rule.id);
      setLatest({
        id: started.evaluationId, contentReviewId: rule.contentReviewId, resultReviewId: rule.resultReviewId,
        ruleEngineResultId: rule.id, evaluationVersion: 'final-evaluation-v1', modelProvider: 'openai', modelName: '',
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
        <div><h2>GPT 最终评定建议</h2><p className="muted">基于已确定的内容、数据复盘和规则候选边界生成。</p></div>
        {canTrigger ? <button className="button" type="button" disabled={submitting} onClick={trigger}>
          {submitting ? '提交中' : videoStatus === 'final_evaluation_failed' ? '重新生成建议' : '生成 GPT 最终评定建议'}
        </button> : null}
      </div>
      <p>当前视频状态：{videoStatus}</p>
      <p className="warning-list">GPT 建议不是最终业务结论。负责人确认后，视频才会进入正式最终状态。</p>
      {loading.rule ? <p className="muted">正在读取规则候选来源。</p> : rule ? (
        <p>规则候选：{rule.ruleResult}；硬边界：{rule.recommendedBoundary}；版本：{rule.ruleVersion}</p>
      ) : <p className="muted">暂无可用规则候选。</p>}
      {loading.latest ? <p className="muted">正在读取最新建议。</p> : null}
      {latest?.status === 'running' ? <p className="muted">GPT 正在基于内容、数据和规则边界生成最终评定建议。</p> : null}
      {latest?.status === 'failed' ? <p className="error">{latest.errorMessage || '最终评定建议生成失败，可重新触发。'}</p> : null}
      {latest?.status === 'succeeded' ? <EvaluationDetails evaluation={latest} /> : null}
      {videoStatus === 'pending_final_confirmation' ? <p className="warning-list">当前仅为 GPT 建议，尚未完成负责人确认。</p> : null}
      {Object.values(errors).filter(Boolean).map((error, index) => <p className="error" key={`${error}-${index}`}>{error}</p>)}
      <h3>历史评定建议</h3>
      {loading.history ? <p className="muted">正在读取历史。</p> : history.items.length === 0 ? <p className="muted">暂无历史建议。</p> : (
        <div className="table-scroll"><table className="table"><thead><tr><th>状态</th><th>建议等级</th><th>置信度</th><th>来源规则</th><th>时间</th></tr></thead><tbody>
          {history.items.map((item) => <tr key={item.id}><td>{item.status}{item.isLatest ? '（最新）' : ''}</td><td>{item.recommendedFinalGrade ? gradeLabels[item.recommendedFinalGrade] : '-'}</td><td>{item.recommendationConfidence ?? '-'}%</td><td>{item.ruleEngineResultId}</td><td>{new Date(item.createdAt).toLocaleString()}</td></tr>)}
        </tbody></table></div>
      )}
    </section>
  );
}
