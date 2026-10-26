'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiUser, apiFetch } from '@/lib/api';
import { DetailSummary } from '@/components/ui/detail-summary';
import { startStatusPolling } from '@/lib/status-polling';
import { holdReasonCode, holdReasonLabel } from '@/lib/display-labels';
const dimensionLabels: Record<string, string> = {
  opening_hook: '前3秒吸引力', selling_point: '卖点表达', structure: '内容结构', visual_quality: '画面质量',
  pacing: '节奏', subtitle_audio: '字幕/声音', platform_fit: '平台适配', action_logic: '行动逻辑',
};

type Run = { id: string; runNumber: number; runRole: string; status: string; totalScore: string | number | null; contentRating: string | null; stale: boolean; modelProvider?: string; modelName?: string; promptVersion?: string; schemaVersion?: string; rubricVersion?: string; factClaimVersion?: string; structuredOutput?: unknown };
type Diagnostic = { dimension: string; weight: number; score: number | null; status: string; observation: string | null; facts: string[]; factClaims: Array<{ key: string; state: string }>; evidence: Array<{ startSeconds: number | null; endSeconds: number | null; description: string }>; improvementSuggestions: string[] | null };
type ContentState = { group: null | { status: string; shadowMode: boolean; runs: Run[]; decision: null | { id: string; totalScore: string | number; contentRating: string; complianceStatus: string; inputComplete: boolean; stable: boolean; decisionSource: string; adoptionMethod: string }; workflowRevision: { revision: number } }; diagnostics: null | { dimensions: Diagnostic[]; directorSummary: { strengths: Array<{ dimension: string; score: number | null; observation: string | null }>; priorities: Array<Diagnostic & { priority: string }>; stableMessage: string | null } } };
type WorkflowState = { revision: null | { revision: number; holds: Array<{ id: string; holdType?: string; reason: string }>; appeals: Array<{ id: string; reason: string }> } };
type RatingsState = { data: null | { dataRating: string | null; dataSufficiency: string }; comprehensive: null | { id: string; comprehensiveRating: string | null; requiresAdminReview: boolean; decisionSource: string | null; finalStatus: string | null; performanceEligible: boolean } };

export function V11EvaluationPanel({ videoId, canTrigger, onContentStateChange }: { videoId: string; canTrigger: boolean; onContentStateChange?: (state: { groupStatus: string | null; activeHoldCount: number }) => void }) {
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
  const [trackedJobId, setTrackedJobId] = useState<string | null>(null);
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
  const groupStatus = content?.group?.status || null;
  const activeHoldCount = workflow?.revision?.holds?.length || 0;
  useEffect(() => { onContentStateChange?.({ groupStatus, activeHoldCount }); }, [activeHoldCount, groupStatus, onContentStateChange]);
  useEffect(() => {
    if (!trackedJobId) return;
    return startStatusPolling<{ status: string }>({
      load: (signal) => apiFetch(`/api/evaluation-jobs/${trackedJobId}`, { signal, cache: 'no-store' }),
      isTerminal: (value) => ['succeeded', 'failed', 'needs_attention', 'uncertain'].includes(value.status),
      onValue: () => void load(),
      onTerminal: () => { setTrackedJobId(null); void load(); },
      onError: () => setError('评估状态查询暂时失败，后台任务不受影响。'),
      onPause: () => setError('自动查询已暂停，请点击刷新获取最新状态。'),
    });
  }, [trackedJobId, load]);
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
  const diagnostics = content?.diagnostics;
  const comprehensive = ratings?.comprehensive;
  const isAdmin = user?.role === 'admin';
  const contentRunning = Boolean(trackedJobId || (content?.group && ['queued', 'running', 'review_required'].includes(content.group.status)));
  const canConfirmPerformance = comprehensive?.comprehensiveRating != null && ['S', 'A+', 'A', 'B'].includes(comprehensive.comprehensiveRating);
  return <section className="panel section-gap" data-testid="v11-evaluation-panel">
    <div className="page-title"><div><h2>V1.1 正式内容评估</h2><p className="muted">{content?.group ? content.group.shadowMode ? '历史 Shadow 结果 · 不参与正式流程' : '当前正式评分来源' : '尚未运行正式评估'}</p></div><button className="button secondary" disabled={busy} onClick={() => void load()}>刷新</button></div>
    <DetailSummary>
    <section className="detail-summary" aria-label="V1.1 当前评估结果">
    <h2>V1.1 评估结果 <span className="status-badge">{content?.group ? content.group.shadowMode ? 'Shadow' : '正式' : '未运行'}</span></h2>
    {content?.group?.shadowMode ? <p className="muted">Shadow 结果不改变正式流程。</p> : null}
    {workflow?.revision?.holds?.map((hold) => <p className="warning-list" role="status" key={`summary-${hold.id}`}><strong>评估结果待确认</strong> · {holdReasonLabel(hold.reason)}</p>)}
    {workflow?.revision?.appeals?.map((item) => <p className="warning-list" role="status" key={`summary-${item.id}`}><strong>当前结果存在异议</strong> · {item.reason}</p>)}
    <div className="grade-summary" aria-label="V1.1 评估摘要">
      <article><span>内容质量</span><strong>{decision?.contentRating || '待评估'}</strong><small>内容分：{decision?.totalScore ?? '-'}{decision?.complianceStatus ? ` · 合规：${decision.complianceStatus}` : ''}</small>{decision ? <dl>{typeof decision.inputComplete === 'boolean' ? <><dt>输入完整</dt><dd>{decision.inputComplete ? '是' : '否'}</dd></> : null}{typeof decision.stable === 'boolean' ? <><dt>结果稳定</dt><dd>{decision.stable ? '是' : '否'}</dd></> : null}{decision.decisionSource ? <><dt>决议来源</dt><dd>{decision.decisionSource === 'system' ? '系统' : decision.decisionSource === 'human' ? '人工' : decision.decisionSource}</dd></> : null}{decision.adoptionMethod ? <><dt>采纳方式</dt><dd>{decision.adoptionMethod}</dd></> : null}</dl> : null}</article>
      <article><span>数据表现</span><strong>{ratings?.data?.dataRating || (ratings?.data?.dataSufficiency === 'insufficient' ? '数据不足' : '待评估')}</strong><small>V1.1 数据等级</small></article>
      <article><span>综合评级</span><strong>{comprehensive?.comprehensiveRating || (comprehensive?.requiresAdminReview ? 'R（管理员复核）' : '待评估')}</strong><small>{comprehensive?.finalStatus || '尚未最终确认'} · 决议来源：{comprehensive?.decisionSource === 'system' ? '系统' : comprehensive?.decisionSource === 'human' ? '人工' : '-'}</small></article>
      <article><span>流程与风险</span><strong>{workflow?.revision?.holds?.length ? '评估结果待确认' : workflow?.revision?.appeals?.length ? '存在异议' : content?.group?.status || '未运行'}</strong><small>{workflow?.revision?.holds?.length ? 'AI评估已完成，但多次结果存在分歧，未形成正式内容决议。' : `模式：${content?.group ? content.group.shadowMode ? 'Shadow' : '正式' : '-'} · 绩效参考：${comprehensive?.finalStatus ? comprehensive.performanceEligible ? '是' : '否' : '待确认'}`}</small></article>
    </div>
    </section>
    </DetailSummary>
    {error ? <p className="error">{error}</p> : null}
    {content?.group ? <section className="panel section-gap" aria-label="AI评估进度"><h3>AI评估进度</h3><ol className="workflow-progress-list">{content.group.runs.length ? content.group.runs.map((run) => <li key={run.id} data-state={run.status}><span>{run.runRole === 'primary' ? '第一次 AI 评估' : run.runRole === 'independent_review' ? '独立复核' : run.runRole === 'third_review' ? '第三次稳定性复核' : run.runRole}</span><small>{run.status === 'succeeded' ? '完成' : run.status === 'running' ? '进行中' : run.status === 'failed' ? '失败' : run.status}</small></li>) : <li><span>{content.group.status === 'queued' ? '排队' : content.group.status === 'running' ? '第一次 AI 评估' : '已提交'}</span><small>{content.group.status}</small></li>}{decision ? <li data-state="completed"><span>生成正式结果</span><small>完成</small></li> : null}</ol>{activeHoldCount > 0 ? <p className="warning-list">评估结果待确认</p> : null}</section> : null}
    {isAdmin ? <details className="section-gap"><summary>技术详情</summary><dl><dt>评估组状态</dt><dd>{content?.group?.status || '-'}</dd><dt>工作流版本</dt><dd>{content?.group?.workflowRevision.revision || workflow?.revision?.revision || '-'}</dd><dt>Hold 类型</dt><dd>{workflow?.revision?.holds?.map((hold) => hold.holdType || 'unknown').join('、') || '-'}</dd><dt>Hold Code</dt><dd>{workflow?.revision?.holds?.map((hold) => holdReasonCode(hold.reason) || hold.reason).join('、') || '-'}</dd><dt>内容决议 ID</dt><dd>{decision?.id || '-'}</dd><dt>综合决议 ID</dt><dd>{comprehensive?.id || '-'}</dd><dt>Run ID</dt><dd>{content?.group?.runs.map((item) => item.id).join('、') || '-'}</dd></dl></details> : null}
    {decision && diagnostics ? <section className="section-gap" aria-label="编导内容诊断"><h3>编导总结</h3><div className="diagnostic-summary"><section><h4>做得好的</h4>{diagnostics.directorSummary.strengths.map((item) => <p key={item.dimension}><strong>{dimensionLabels[item.dimension] || item.dimension}</strong> · {item.observation || '已纳入正式决议'}</p>)}</section><section><h4>优先修改</h4>{diagnostics.directorSummary.priorities.length ? diagnostics.directorSummary.priorities.map((item) => <p key={item.dimension}><strong>{item.priority} · {dimensionLabels[item.dimension] || item.dimension}</strong><br />{item.improvementSuggestions?.[0]}</p>) : <p>{diagnostics.directorSummary.stableMessage}</p>}</section></div><h3 className="section-gap">8 维诊断</h3><div className="diagnostic-grid">{diagnostics.dimensions.map((item) => <article className="panel diagnostic-card" key={item.dimension}><header><div><h4>{dimensionLabels[item.dimension] || item.dimension}</h4><small>{item.status}</small></div><strong>{item.score === null ? '无法判断' : `${Number.isInteger(item.score) ? item.score : item.score.toFixed(1)} / ${item.weight} 分`}</strong></header><p>{item.observation || '该维度没有可用的代表 Run 观察内容。'}</p><h5>关键事实</h5><ul>{item.facts.map((fact, index) => <li key={`${item.dimension}-fact-${index}`}>{fact}</li>)}</ul><h5>证据</h5><ul>{item.evidence.map((evidence, index) => <li key={`${item.dimension}-evidence-${index}`}>{evidence.startSeconds === null ? '' : `${evidence.startSeconds.toFixed(1)}s`}{evidence.endSeconds === null ? '' : `–${evidence.endSeconds.toFixed(1)}s`} {evidence.description}</li>)}</ul><h5>修改建议</h5>{item.improvementSuggestions === null ? <p className="muted">该历史评估版本未生成修改建议</p> : item.improvementSuggestions.length ? <ul>{item.improvementSuggestions.map((suggestion, index) => <li key={`${item.dimension}-suggestion-${index}`}>{suggestion}</li>)}</ul> : <p className="muted">当前维度没有明确的修改建议。</p>}</article>)}</div></section> : null}
    {isAdmin && content?.group?.runs?.length ? <div className="table-scroll"><table className="table"><thead><tr><th>评估</th><th>角色</th><th>状态</th><th>分数</th><th>等级</th><th>技术详情</th></tr></thead><tbody>{content.group.runs.map((item) => <tr key={item.id}><td>第 {item.runNumber} 次</td><td>{item.runRole}</td><td>{item.stale ? '已失效' : item.status}</td><td>{item.totalScore ?? '-'}</td><td>{item.contentRating || '-'}</td><td><details><summary>版本与结构化结果</summary><dl><dt>Model</dt><dd>{item.modelProvider || '-'} / {item.modelName || '-'}</dd><dt>Prompt</dt><dd>{item.promptVersion || '-'}</dd><dt>Schema</dt><dd>{item.schemaVersion || '-'}</dd><dt>Rubric</dt><dd>{item.rubricVersion || '-'}</dd><dt>Fact Claim</dt><dd>{item.factClaimVersion || '历史版本未记录'}</dd></dl><pre className="diagnostic-json">{JSON.stringify(item.structuredOutput ?? null, null, 2)}</pre></details></td></tr>)}</tbody></table></div> : null}
    {workflow?.revision?.holds?.map((hold) => <p className="warning-list" key={hold.id}>评估结果待确认：{holdReasonLabel(hold.reason)}</p>)}
    {workflow?.revision?.appeals?.map((item) => <p className="warning-list" key={item.id}>异议处理中：{item.reason}</p>)}
    <div className="button-row">{canTrigger ? <button className="button" disabled={busy || contentRunning} onClick={async () => {
      setBusy(true); setError('');
      try {
        const started = await apiFetch<{ jobId?: string }>(`/api/videos/${videoId}/v11-content-review`, { method: 'POST' });
        setTrackedJobId(started.jobId ?? null);
        await load();
      } catch (cause) { setError(cause instanceof Error ? cause.message : '内容评估启动失败。'); }
      finally { setBusy(false); }
    }}>{contentRunning ? '评估中...' : '开始内容评估'}</button> : null}<button className="button secondary" disabled={busy || !decision} onClick={() => void run(`/api/v11/videos/${videoId}/data-rating`)}>计算数据等级</button><button className="button secondary" disabled={busy || !ratings?.data?.dataRating} onClick={() => void run(`/api/v11/videos/${videoId}/comprehensive-rating`)}>计算综合等级</button></div>
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
