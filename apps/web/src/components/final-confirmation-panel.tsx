'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  allowedFinalGrades,
  CaseType,
  FinalEvaluationLatestResponse,
  FinalGrade,
  RuleEngineLatestResponse,
} from '@ai-video-qc/shared';
import { apiFetch, ApiUser } from '@/lib/api';
import {
  canConfirmFinalEvaluation,
  finalConfirmationError,
  finalConfirmationValidation,
  submitCaseMarking,
  submitFinalConfirmation,
} from '@/lib/final-confirmation-ui';

const gradeLabels: Record<FinalGrade, string> = { effective: '有效', low_effective: '低有效', invalid: '无效' };

export function FinalConfirmationPanel({ videoId, videoStatus, currentUser, onVideoRefresh }: {
  videoId: string; videoStatus: string; currentUser: ApiUser | null; onVideoRefresh: () => Promise<void>;
}) {
  const [evaluation, setEvaluation] = useState<FinalEvaluationLatestResponse['evaluation']>(null);
  const [rule, setRule] = useState<RuleEngineLatestResponse['ruleEngineResult']>(null);
  const [errors, setErrors] = useState({ evaluation: '', rule: '', action: '' });
  const [finalGrade, setFinalGrade] = useState<FinalGrade>('effective');
  const [performance, setPerformance] = useState(false);
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [caseType, setCaseType] = useState<CaseType>('none');
  const [caseReason, setCaseReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const [evaluationResult, ruleResult] = await Promise.allSettled([
      apiFetch<FinalEvaluationLatestResponse>(`/api/videos/${videoId}/final-evaluation/latest`),
      apiFetch<RuleEngineLatestResponse>(`/api/videos/${videoId}/rule-engine/latest`),
    ]);
    if (evaluationResult.status === 'fulfilled') {
      setEvaluation(evaluationResult.value.evaluation);
      const suggested = evaluationResult.value.evaluation?.recommendedFinalGrade;
      if (suggested) setFinalGrade(suggested);
      setErrors((state) => ({ ...state, evaluation: '' }));
    } else setErrors((state) => ({ ...state, evaluation: '正式确认信息暂时不可用。' }));
    if (ruleResult.status === 'fulfilled') {
      setRule(ruleResult.value.ruleEngineResult);
      setErrors((state) => ({ ...state, rule: '' }));
    } else setErrors((state) => ({ ...state, rule: '规则边界暂时不可用。' }));
  }, [videoId]);

  useEffect(() => { void load(); }, [load]);
  const canConfirm = canConfirmFinalEvaluation(currentUser, videoStatus, evaluation);
  const grades = useMemo(() => rule ? allowedFinalGrades(rule.recommendedBoundary) : [], [rule]);

  async function confirm() {
    if (!evaluation || !rule || submitting) return;
    const validation = finalConfirmationValidation({
      boundary: rule.recommendedBoundary, finalGrade, recommendedFinalGrade: evaluation.recommendedFinalGrade,
      canBeUsedForPerformance: performance, confirmationComment: comment, manualAdjustReason: reason,
    });
    if (validation) return setErrors((state) => ({ ...state, action: validation }));
    if (!window.confirm('最终确认不可撤销。确认将视频写入正式终态吗？')) return;
    setSubmitting(true); setErrors((state) => ({ ...state, action: '' }));
    try {
      await submitFinalConfirmation(apiFetch, videoId, {
        evaluationId: evaluation.id, finalGrade, canBeUsedForPerformance: performance,
        ...(comment.trim() ? { confirmationComment: comment.trim() } : {}),
        ...(reason.trim() ? { manualAdjustReason: reason.trim() } : {}),
      });
      await load(); await onVideoRefresh();
    } catch (error) { setErrors((state) => ({ ...state, action: finalConfirmationError(error) })); }
    finally { setSubmitting(false); }
  }

  async function markCase() {
    if (!evaluation || caseReason.trim().length < 5 || submitting) {
      setErrors((state) => ({ ...state, action: '案例标记说明至少需要 5 个字符。' })); return;
    }
    setSubmitting(true);
    try {
      await submitCaseMarking(apiFetch, videoId, { evaluationId: evaluation.id, caseType, reason: caseReason.trim() });
      await load();
    } catch (error) { setErrors((state) => ({ ...state, action: finalConfirmationError(error) })); }
    finally { setSubmitting(false); }
  }

  return (
    <section className="panel section-gap final-confirmation">
      <div className="page-title"><div><h2>负责人最终确认</h2><p className="muted">规则引擎控制硬边界，负责人保存正式业务结论。</p></div></div>
      {!evaluation ? <p className="muted">暂无最终评定建议。</p> : (
        <div className="review-result">
          <p>GPT 建议：{evaluation.recommendedFinalGrade ? gradeLabels[evaluation.recommendedFinalGrade] : '-'}</p>
          <p>规则硬边界：{rule?.recommendedBoundary || '-'}</p>
          {evaluation.confirmedAt ? <>
            <p><strong>正式等级：{evaluation.finalGrade ? gradeLabels[evaluation.finalGrade] : '-'}</strong></p>
            <p>正式状态：{evaluation.finalStatus || '-'}</p>
            <p>确认人：{evaluation.confirmedBy?.name || '-'}；确认时间：{new Date(evaluation.confirmedAt).toLocaleString()}</p>
            <p>确认说明：{evaluation.confirmationComment || '-'}</p>
            <p>人工调整原因：{evaluation.manualAdjustReason || '-'}</p>
            <p>绩效参考资格：{evaluation.canBeUsedForPerformance ? '可作为参考' : '不可作为参考'}</p>
            <p className="warning-list">绩效参考资格仅表示可进入人工绩效参考材料，不代表自动计算工资或绩效。</p>
          </> : null}
          {canConfirm ? <div className="form-grid">
            <label className="form-field">正式等级<select value={finalGrade} onChange={(event) => setFinalGrade(event.target.value as FinalGrade)}>
              {grades.map((grade) => <option value={grade} key={grade}>{gradeLabels[grade]}</option>)}
            </select></label>
            <label className="form-field">绩效参考资格<select value={performance ? 'yes' : 'no'} onChange={(event) => setPerformance(event.target.value === 'yes')}>
              <option value="no">不可作为参考</option><option value="yes">可作为参考</option>
            </select></label>
            <label className="form-field full">确认说明<textarea value={comment} onChange={(event) => setComment(event.target.value)} /></label>
            {evaluation.recommendedFinalGrade !== finalGrade ? <label className="form-field full">调整原因<textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label> : null}
            <div className="form-field full"><button className="button danger-button" type="button" onClick={confirm} disabled={submitting}>{submitting ? '提交中' : '确认正式结论'}</button></div>
          </div> : null}
          {evaluation.confirmedAt && currentUser && ['admin', 'content_owner'].includes(currentUser.role) ? <div className="case-marking">
            <h3>案例库标记</h3>
            <div className="form-grid">
              <label className="form-field">案例类型<select value={caseType} onChange={(event) => setCaseType(event.target.value as CaseType)}>
                <option value="none">移除案例标记</option>
                {evaluation.finalGrade === 'effective' ? <option value="excellent">优秀案例</option> : null}
                {evaluation.finalGrade === 'invalid' ? <option value="negative">反面案例</option> : null}
              </select></label>
              <label className="form-field full">标记说明<textarea value={caseReason} onChange={(event) => setCaseReason(event.target.value)} /></label>
              <div className="form-field full"><button className="button secondary" type="button" onClick={markCase} disabled={submitting}>保存案例标记</button></div>
            </div>
          </div> : null}
        </div>
      )}
      {Object.values(errors).filter(Boolean).map((error) => <p className="error" key={error}>{error}</p>)}
    </section>
  );
}
