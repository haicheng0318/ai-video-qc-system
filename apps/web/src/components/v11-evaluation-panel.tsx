'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiUser, apiFetch } from '@/lib/api';
import { DetailSummary } from '@/components/ui/detail-summary';

type Run = { id: string; runNumber: number; runRole: string; status: string; totalScore: string | number | null; contentRating: string | null; stale: boolean };
type ContentState = { group: null | { status: string; shadowMode: boolean; runs: Run[]; decision: null | { id: string; totalScore: string | number; contentRating: string; complianceStatus: string; inputComplete: boolean; stable: boolean; decisionSource: string; adoptionMethod: string }; workflowRevision: { revision: number } } };
type WorkflowState = { revision: null | { revision: number; holds: Array<{ id: string; reason: string }>; appeals: Array<{ id: string; reason: string }> } };
type RatingsState = { data: null | { dataRating: string | null; dataSufficiency: string }; comprehensive: null | { id: string; comprehensiveRating: string | null; requiresAdminReview: boolean; decisionSource: string | null; finalStatus: string | null; performanceEligible: boolean } };

export function V11EvaluationPanel({ videoId }: { videoId: string }) {
  const [content, setContent] = useState<ContentState | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null);
  const [ratings, setRatings] = useState<RatingsState | null>(null);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [reason, setReason] = useState('');
  const [adminReason, setAdminReason] = useState('');
  const [manualRating, setManualRating] = useState('A');
  const [performanceEligible, setPerformanceEligible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const results = await Promise.allSettled([
      apiFetch<ContentState>(`/api/videos/${videoId}/v11-content-review/latest`),
      apiFetch<WorkflowState>(`/api/videos/${videoId}/v11-workflow`),
      apiFetch<RatingsState>(`/api/v11/videos/${videoId}/ratings/latest`),
      apiFetch<{ user: ApiUser }>('/api/auth/me'),
    ]);
    if (results[0].status === 'fulfilled') setContent(results[0].value);
    if (results[1].status === 'fulfilled') setWorkflow(results[1].value);
    if (results[2].status === 'fulfilled') setRatings(results[2].value);
    if (results[3].status === 'fulfilled') setUser(results[3].value.user);
    if (results.every((result) => result.status === 'rejected')) setError('V1.1 评估信息暂时不可用。');
  }, [videoId]);
  useEffect(() => { void load(); }, [load]);
  async function run(path: string) {
    setBusy(true); setError('');
    try { await apiFetch(path, { method: 'POST' }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败。'); }
    finally { setBusy(false); }
  }
  async function appeal(event: FormEvent) {
    event.preventDefault();
    const resultId = content?.group?.decision?.id;
    if (!resultId || reason.trim().length < 10) { setError('异议原因需填写 10–500 个字符。'); return; }
    setBusy(true); setError('');
    try {
      await apiFetch(`/api/videos/${videoId}/v11-workflow/appeals`, { method: 'POST', body: JSON.stringify({ stage: 'content', resultId, reason: reason.trim() }) });
      setReason(''); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '提交异议失败。'); }
    finally { setBusy(false); }
  }
  async function resolveManual(event: FormEvent) {
    event.preventDefault();
    if (adminReason.trim().length < 10) { setError('人工决议理由需填写 10–500 个字符。'); return; }
    setBusy(true); setError('');
    try {
      await apiFetch(`/api/v11/videos/${videoId}/comprehensive-rating/manual`, {
        method: 'POST',
        body: JSON.stringify({ rating: manualRating, reason: adminReason.trim() }),
      });
      setAdminReason(''); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '人工决议失败。'); }
    finally { setBusy(false); }
  }
  async function confirmFinal(event: FormEvent) {
    event.preventDefault();
    const comprehensive = ratings?.comprehensive;
    if (!comprehensive || adminReason.trim().length < 10) { setError('确认理由需填写 10–500 个字符。'); return; }
    setBusy(true); setError('');
    try {
      await apiFetch(`/api/v11/videos/${videoId}/comprehensive-rating/confirm`, {
        method: 'POST',
        body: JSON.stringify({ decisionId: comprehensive.id, reason: adminReason.trim(), performanceEligible }),
      });
      setAdminReason(''); setPerformanceEligible(false); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '最终确认失败。'); }
    finally { setBusy(false); }
  }
  const decision = content?.group?.decision;
  const comprehensive = ratings?.comprehensive;
  const isAdmin = user?.role === 'admin';
  const canConfirmPerformance = comprehensive?.comprehensiveRating != null && ['S', 'A+', 'A', 'B'].includes(comprehensive.comprehensiveRating);
  return <section className="panel section-gap" data-testid="v11-evaluation-panel">
    <div className="page-title"><div><h2>V1.1 稳定性评估</h2><p className="muted">{content?.group ? content.group.shadowMode ? 'Shadow 评估 · 不改变正式流程' : '正式评估' : '尚未运行 V1.1 评估'}</p></div><button className="button secondary" disabled={busy} onClick={() => void load()}>刷新</button></div>
    <DetailSummary>
    <section className="detail-summary" aria-label="V1.1 当前评估结果">
    <h2>V1.1 评估结果 <span className="status-badge">{content?.group ? content.group.shadowMode ? 'Shadow' : '正式' : '未运行'}</span></h2>
    {content?.group?.shadowMode ? <p className="muted">Shadow 结果不改变正式流程。</p> : null}
    {workflow?.revision?.holds?.map((hold) => <p className="warning-list" role="status" key={`summary-${hold.id}`}><strong>当前流程已暂停：Hold</strong> · {hold.reason}</p>)}
    {workflow?.revision?.appeals?.map((item) => <p className="warning-list" role="status" key={`summary-${item.id}`}><strong>当前结果存在异议</strong> · {item.reason}</p>)}
    <div className="grade-summary" aria-label="V1.1 评估摘要">
      <article><span>内容质量</span><strong>{decision?.contentRating || '待评估'}</strong><small>内容分：{decision?.totalScore ?? '-'}{decision?.complianceStatus ? ` · 合规：${decision.complianceStatus}` : ''}</small>{decision ? <dl>{typeof decision.inputComplete === 'boolean' ? <><dt>输入完整</dt><dd>{decision.inputComplete ? '是' : '否'}</dd></> : null}{typeof decision.stable === 'boolean' ? <><dt>结果稳定</dt><dd>{decision.stable ? '是' : '否'}</dd></> : null}{decision.decisionSource ? <><dt>决议来源</dt><dd>{decision.decisionSource === 'system' ? '系统' : decision.decisionSource === 'human' ? '人工' : decision.decisionSource}</dd></> : null}{decision.adoptionMethod ? <><dt>采纳方式</dt><dd>{decision.adoptionMethod}</dd></> : null}</dl> : null}</article>
      <article><span>数据表现</span><strong>{ratings?.data?.dataRating || (ratings?.data?.dataSufficiency === 'insufficient' ? '数据不足' : '待评估')}</strong><small>V1.1 数据等级</small></article>
      <article><span>综合评级</span><strong>{comprehensive?.comprehensiveRating || (comprehensive?.requiresAdminReview ? 'R（管理员复核）' : '待评估')}</strong><small>{comprehensive?.finalStatus || '尚未最终确认'} · 决议来源：{comprehensive?.decisionSource === 'system' ? '系统' : comprehensive?.decisionSource === 'human' ? '人工' : '-'}</small></article>
      <article><span>流程与风险</span><strong>{workflow?.revision?.holds?.length ? 'Hold · 流程暂停' : workflow?.revision?.appeals?.length ? '存在异议' : content?.group?.status || '未运行'}</strong><small>模式：{content?.group ? content.group.shadowMode ? 'Shadow' : '正式' : '-'} · 绩效参考：{comprehensive?.finalStatus ? comprehensive.performanceEligible ? '是' : '否' : '待确认'}</small></article>
    </div>
    </section>
    </DetailSummary>
    {error ? <p className="error">{error}</p> : null}
    {isAdmin ? <details className="section-gap"><summary>技术详情</summary><dl><dt>评估组状态</dt><dd>{content?.group?.status || '-'}</dd><dt>工作流版本</dt><dd>{content?.group?.workflowRevision.revision || workflow?.revision?.revision || '-'}</dd><dt>Review ID</dt><dd>{decision?.id || '-'}</dd><dt>Evaluation ID</dt><dd>{comprehensive?.id || '-'}</dd><dt>Run ID</dt><dd>{content?.group?.runs.map((item) => item.id).join('、') || '-'}</dd></dl></details> : null}
    {content?.group?.runs?.length ? <div className="table-scroll"><table className="table"><thead><tr><th>评估</th><th>角色</th><th>状态</th><th>分数</th><th>等级</th></tr></thead><tbody>{content.group.runs.map((item) => <tr key={item.id}><td>第 {item.runNumber} 次</td><td>{item.runRole}</td><td>{item.stale ? '已失效' : item.status}</td><td>{item.totalScore ?? '-'}</td><td>{item.contentRating || '-'}</td></tr>)}</tbody></table></div> : null}
    {workflow?.revision?.holds?.map((hold) => <p className="warning-list" key={hold.id}>流程挂起：{hold.reason}</p>)}
    {workflow?.revision?.appeals?.map((item) => <p className="warning-list" key={item.id}>异议处理中：{item.reason}</p>)}
    <div className="button-row"><button className="button" disabled={busy} onClick={() => void run(`/api/videos/${videoId}/v11-content-review`)}>触发 V1.1 内容评估</button><button className="button secondary" disabled={busy || !decision} onClick={() => void run(`/api/v11/videos/${videoId}/data-rating`)}>计算数据等级</button><button className="button secondary" disabled={busy || !ratings?.data?.dataRating} onClick={() => void run(`/api/v11/videos/${videoId}/comprehensive-rating`)}>计算综合等级</button></div>
    {isAdmin && comprehensive?.requiresAdminReview ? <form onSubmit={resolveManual} className="section-gap">
      <h3>管理员人工决议</h3>
      <p className="muted">R 组合必须由管理员结合证据选择 A / B / B- / C / D，不能人工提升为 S 或 A+。</p>
      <label>综合等级<select value={manualRating} onChange={(event) => setManualRating(event.target.value)}><option value="A">A</option><option value="B">B</option><option value="B-">B-</option><option value="C">C</option><option value="D">D</option></select></label>
      <label>人工决议理由<textarea minLength={10} maxLength={500} value={adminReason} onChange={(event) => setAdminReason(event.target.value)} /></label>
      <button className="button" disabled={busy || adminReason.trim().length < 10}>提交人工决议</button>
    </form> : null}
    {isAdmin && comprehensive?.comprehensiveRating && !comprehensive.requiresAdminReview && !comprehensive.finalStatus ? <form onSubmit={confirmFinal} className="section-gap">
      <h3>负责人最终确认</h3>
      <p className="muted">确认当前综合等级 {comprehensive.comprehensiveRating}。此操作不会修改模型或规则得出的等级。</p>
      <label>确认理由<textarea minLength={10} maxLength={500} value={adminReason} onChange={(event) => setAdminReason(event.target.value)} /></label>
      {canConfirmPerformance ? <label className="checkbox-row"><input type="checkbox" checked={performanceEligible} onChange={(event) => setPerformanceEligible(event.target.checked)} />纳入绩效参考资格</label> : null}
      <button className="button" disabled={busy || adminReason.trim().length < 10}>确认正式结果</button>
    </form> : null}
    {decision ? <form onSubmit={appeal} className="section-gap"><label>对当前内容结果提出异议<textarea minLength={10} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="请说明具体异议与可核对的时间点" /></label><button className="button secondary" disabled={busy || reason.trim().length < 10}>提交异议并创建新工作流版本</button></form> : null}
  </section>;
}
