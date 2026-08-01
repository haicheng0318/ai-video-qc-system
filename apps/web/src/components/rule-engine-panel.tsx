'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RuleEngineHistoryResponse,
  RuleEngineLatestResponse,
  RuleEngineResultView,
} from '@ai-video-qc/shared';
import { apiFetch, ApiUser } from '@/lib/api';
import { ResultReview } from '@/lib/result-review-ui';
import {
  canExecuteRuleEngine,
  executeRuleEngine,
  loadRuleEngineRequests,
  ruleEngineErrorMessage,
} from '@/lib/rule-engine-ui';

const emptyHistory: RuleEngineHistoryResponse = { items: [], nextCursor: null };

const resultLabels: Record<string, string> = {
  pending_data: '等待补充数据',
  excellent_effective_candidate: '优秀有效候选',
  effective_candidate: '有效候选',
  potential_effective_candidate: '潜在有效候选',
  basic_effective_candidate: '基础有效候选',
  content_good_result_poor: '内容较好但结果较弱候选',
  abnormal_need_confirmation: '异常待确认候选',
  invalid_candidate: '无效候选',
};

const boundaryLabels: Record<string, string> = {
  pending_data: '等待补充数据',
  allow_final_effective: '允许进入有效边界评定',
  allow_final_effective_or_low_effective: '允许进入有效或低有效边界评定',
  allow_final_low_effective_or_invalid: '允许进入低有效或无效边界评定',
  require_manual_confirmation: '必须人工确认',
  require_final_invalid: '必须进入无效边界复核',
};

function RuleResultDetails({ result }: { result: RuleEngineResultView }) {
  return (
    <div className="review-result">
      <p>规则版本：{result.ruleVersion}</p>
      <p>内容质量等级：{result.contentGrade}</p>
      <p>数据充分性：{result.dataSufficiency === 'sufficient' ? '充分' : '不足'}</p>
      <p>数据表现等级：{result.dataGrade || '-'}</p>
      <p>命中规则：{result.ruleCode}</p>
      <p>规则引擎候选：{resultLabels[result.ruleResult] || result.ruleResult}</p>
      <p>硬边界：{boundaryLabels[result.recommendedBoundary] || result.recommendedBoundary}</p>
      <p>规则理由：{result.ruleReason}</p>
      <p>来源内容评估：{result.contentReviewId}</p>
      <p>来源数据复盘：{result.resultReviewId}</p>
      <p>执行时间：{new Date(result.createdAt).toLocaleString()}</p>
    </div>
  );
}

export function RuleEnginePanel({
  videoId,
  videoStatus,
  currentUser,
  onVideoRefresh,
}: {
  videoId: string;
  videoStatus: string;
  currentUser: ApiUser | null;
  onVideoRefresh: () => Promise<void>;
}) {
  const [resultReview, setResultReview] = useState<ResultReview | null>(null);
  const [latest, setLatest] = useState<RuleEngineResultView | null>(null);
  const [history, setHistory] = useState<RuleEngineHistoryResponse>(emptyHistory);
  const [latestError, setLatestError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [resultReviewError, setResultReviewError] = useState('');
  const [actionError, setActionError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resultReviewLoading, setResultReviewLoading] = useState(true);
  const [latestLoading, setLatestLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const requestGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLatestError('');
    setHistoryError('');
    setResultReviewError('');
    setResultReviewLoading(true);
    setLatestLoading(true);
    setHistoryLoading(true);
    await loadRuleEngineRequests({
      loadResultReview: () => apiFetch(`/api/videos/${videoId}/result-review/latest`),
      loadLatest: () => apiFetch(`/api/videos/${videoId}/rule-engine/latest`),
      loadHistory: () => apiFetch(`/api/videos/${videoId}/rule-engine/history?limit=20`),
      onResultReview: (value) => { if (generation === requestGeneration.current) { setResultReview(value.review); setResultReviewLoading(false); } },
      onLatest: (value) => { if (generation === requestGeneration.current) { setLatest(value.ruleEngineResult); setLatestLoading(false); } },
      onHistory: (value) => { if (generation === requestGeneration.current) { setHistory(value); setHistoryLoading(false); } },
      onResultReviewError: () => { if (generation === requestGeneration.current) { setResultReviewError('GPT 复盘结果暂时不可用。'); setResultReviewLoading(false); } },
      onLatestError: () => { if (generation === requestGeneration.current) { setLatestError('最新规则结果暂时不可用。'); setLatestLoading(false); } },
      onHistoryError: () => { if (generation === requestGeneration.current) { setHistoryError('规则历史暂时不可用。'); setHistoryLoading(false); } },
    });
  }, [videoId]);

  useEffect(() => {
    setResultReview(null);
    setLatest(null);
    setHistory(emptyHistory);
    let active = true;
    load().catch(() => { if (active) setLatestError('最新规则结果暂时不可用。'); });
    return () => { active = false; requestGeneration.current += 1; };
  }, [load, videoId]);

  const canExecute = useMemo(
    () => canExecuteRuleEngine(currentUser, videoStatus, resultReview, latest),
    [currentUser, latest, resultReview, videoStatus],
  );

  async function execute() {
    if (!resultReview || submitting) return;
    setSubmitting(true);
    setActionError('');
    try {
      await executeRuleEngine(apiFetch, videoId, resultReview.id);
      await onVideoRefresh();
      await load();
    } catch (error) {
      setActionError(ruleEngineErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel section-gap rule-engine-result">
      <div className="page-title">
        <div>
          <h2>后端规则判断</h2>
          <p className="muted">规则引擎只根据内容等级、数据等级和数据充分性执行确定性判断，不调用 AI。</p>
        </div>
        {canExecute ? (
          <button className="button" type="button" disabled={submitting} onClick={execute}>
            {submitting ? '执行中' : '执行规则判断'}
          </button>
        ) : null}
      </div>
      <p>当前视频状态：{videoStatus}</p>
      <p className="warning-list">规则候选结果不是最终有效等级，最终结果仍需经过 GPT 最终评定和负责人确认。</p>
      {resultReviewLoading ? <p className="muted">正在读取 GPT 复盘来源。</p> : null}
      {latestLoading ? <p className="muted">正在读取最新规则结果。</p> : latest ? <RuleResultDetails result={latest} /> : <p className="muted">暂无规则判断结果。</p>}
      {latest?.dataSufficiency === 'sufficient' ? <p className="muted">规则判断已完成，等待 GPT 最终评定。</p> : null}
      {latest?.dataSufficiency === 'insufficient' ? <p className="warning-list">当前数据不足，需补充新的运营/投放数据后重新复盘。</p> : null}
      {resultReviewError ? <p className="error">{resultReviewError}</p> : null}
      {latestError ? <p className="error">{latestError}</p> : null}
      {historyError ? <p className="error">{historyError}</p> : null}
      {actionError ? <p className="error">{actionError}</p> : null}

      <h3>历史规则记录</h3>
      {historyLoading ? <p className="muted">正在读取规则历史。</p> : history.items.length === 0 ? <p className="muted">暂无历史规则记录。</p> : (
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>规则</th><th>内容/数据等级</th><th>候选结果</th><th>硬边界</th><th>时间</th></tr></thead>
            <tbody>
              {history.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.ruleCode}{item.isLatest ? '（最新）' : ''}<br />{item.ruleVersion}</td>
                  <td>{item.contentGrade} / {item.dataGrade || '数据不足'}</td>
                  <td>{resultLabels[item.ruleResult] || item.ruleResult}</td>
                  <td>{boundaryLabels[item.recommendedBoundary] || item.recommendedBoundary}</td>
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
