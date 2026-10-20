'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { startStatusPolling, PollingPauseReason } from '@/lib/status-polling';
import { VideoPlayer } from '@/components/video-player';
import { ApiUser } from '@/lib/api';
import { loadVideoDetailRequests } from '@/lib/video-detail-loader';
import { SupervisorReviewPanel, SupervisorReviewView } from '@/components/supervisor-review-panel';
import { VideoRevisionPanel } from '@/components/video-revision-panel';
import { VideoVersionChain } from '@/components/video-version-chain';
import { ResultMetricsPanel } from '@/components/result-metrics-panel';
import { VideoType } from '@ai-video-qc/shared';
import { ResultReviewPanel } from '@/components/result-review-panel';
import { RuleEnginePanel } from '@/components/rule-engine-panel';
import { FinalEvaluationPanel } from '@/components/final-evaluation-panel';
import { FinalConfirmationPanel } from '@/components/final-confirmation-panel';
import { V11EvaluationPanel } from '@/components/v11-evaluation-panel';
import {
  displayLabel,
  contentDimensionLabels,
  finalGradeLabels,
  operationLogActionLabels,
  operationLogDescription,
  priorityLabels,
  reviewStatusLabels,
  severityLabels,
  userFacingErrorMessage,
  videoStatusLabels,
  videoTypeLabels,
} from '@/lib/display-labels';
import { formatShanghaiDateTime } from '@/lib/display-time';
import { shouldApplyLatestSelection } from '@/lib/workflow-refresh';

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
  complianceRisks?: Array<{ riskType: string; description: string; timestamp?: string | null; severity?: string }> | null;
  usableScenarios?: string[] | null;
  scoringVersion?: string | null;
  promptVersion?: string | null;
  scoreCalculation?: 'backend_deterministic' | 'legacy_model_reported';
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
  videoType: VideoType;
  status: string;
  scriptDescription?: string;
  isForAds: boolean;
  isEventVideo: boolean;
  eventName?: string;
  createdAt: string;
  updatedAt?: string;
  version?: number;
  isTrial?: boolean;
  creator?: {
    id: string;
    name: string;
    account: string;
  };
  aiContentReviews?: unknown[];
  supervisorReview?: SupervisorReviewView | null;
  resultMetrics?: unknown[];
  aiResultReviews?: Array<{ status: string; dataGrade?: string | null }>;
  ruleEngineResults?: unknown[];
  finalVideoEvaluations?: Array<{ finalGrade?: string | null; recommendedFinalGrade?: string | null; confirmedAt?: string | null }>;
  operationLogs?: Array<{ id: string; actionType: string; createdAt: string; comment?: string }>;
  parentVideo?: VersionLink | null;
  revisions?: VersionLink[];
  versionChain?: VersionLink[];
  allowedActions: string[];
  latestResultMetricId?: string | null;
};

type VersionLink = { id: string; title: string; status: string; version: number };
type DetailTab = 'content' | 'metrics' | 'final' | 'versions' | 'logs';
const detailTabs: Array<[DetailTab, string]> = [['content', '评估结果'], ['metrics', '数据表现'], ['final', '综合决策'], ['versions', '版本记录'], ['logs', '操作记录']];
const actionTabs: Record<string, DetailTab> = {
  trigger_content_review: 'content', submit_supervisor_review: 'content', upload_revision: 'content',
  submit_result_metrics: 'metrics', trigger_result_review: 'metrics', execute_rule_engine: 'final',
  trigger_final_evaluation: 'final', confirm_final_evaluation: 'final', mark_case: 'final',
};
const workflowSteps = [
  { label: '内容评估', statuses: ['submitted', 'ai_content_reviewing', 'ai_content_failed'] },
  { label: '主管审核', statuses: ['pending_supervisor_review', 'revision_required', 'invalid_content'] },
  { label: '数据表现', statuses: ['approved_for_publish', 'pending_result_data', 'pending_data'] },
  { label: 'AI复盘', statuses: ['ai_result_reviewing', 'ai_result_failed'] },
  { label: '综合判断', statuses: ['pending_rule_engine', 'pending_final_evaluation', 'final_evaluation_failed'] },
  { label: '负责人确认', statuses: ['pending_final_confirmation', 'final_effective', 'final_low_effective', 'final_invalid'] },
];

const actionLabels: Record<string, string> = {
  trigger_content_review: '可开始内容评估', submit_supervisor_review: '可进行主管初审', upload_revision: '可上传返修版本',
  submit_result_metrics: '可补充运营/投放数据', trigger_result_review: '可开始数据复盘', execute_rule_engine: '可执行规则判断',
  trigger_final_evaluation: '可生成最终评定建议', confirm_final_evaluation: '等待负责人确认', mark_case: '可进行案例库标记',
};
function nextActionText(actions: string[], status: string) {
  const action = actions.find((item) => item !== 'export_report');
  if (action) return actionLabels[action] || '可继续处理';
  if (['ai_content_reviewing', 'ai_result_reviewing', 'pending_final_evaluation'].includes(status)) return '后台任务处理中，可离开页面';
  if (['final_effective', 'final_low_effective', 'final_invalid'].includes(status)) return '流程已完成';
  return '当前账号暂无可执行动作，请等待对应角色处理';
}

export default function VideoDetailPage({ params: pendingParams }: { params: Promise<{ id: string }> }) {
  const params = use(pendingParams);
  return <VideoDetail key={params.id} params={params} />;
}

function VideoDetail({ params }: { params: { id: string } }) {
  const active = useRef(true);
  const triggering = useRef(false);
  const [video, setVideo] = useState<VideoDetail | null>(null);
  const [contentReview, setContentReview] = useState<ContentReview | null>(null);
  const [trackedReviewId, setTrackedReviewId] = useState<string | null>(null);
  const [pollPause, setPollPause] = useState<PollingPauseReason | null>(null);
  const [pollAttempt, setPollAttempt] = useState(0);
  const [error, setError] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [latestError, setLatestError] = useState('');
  const [currentUser, setCurrentUser] = useState<ApiUser | null>(null);
  const [supervisorReview, setSupervisorReview] = useState<SupervisorReviewView | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('content');
  const pinnedContentReviewId = useRef<string | null>(null);

  const loadVideo = useCallback(async () => {
    if (!active.current) return;
    setError('');
    setLatestError('');
    await loadVideoDetailRequests({
      loadDetail: () => apiFetch<VideoDetail>(`/api/videos/${params.id}`),
      loadLatest: () => apiFetch<{ review: ContentReview | null }>(`/api/videos/${params.id}/content-review/latest`),
      onDetail: (value) => { if (active.current) setVideo(value); },
      onLatest: (latest) => {
        if (!active.current) return;
        if (shouldApplyLatestSelection(pinnedContentReviewId.current, latest.review?.id)) setContentReview(latest.review);
        if (!pinnedContentReviewId.current && latest.review?.status === 'running') pinnedContentReviewId.current = latest.review.id;
      },
      onLatestError: () => { if (active.current) setLatestError('评估结果暂时不可用，请稍后重试。'); },
    });
    const [userResult, supervisorResult] = await Promise.allSettled([
      apiFetch<{ user: ApiUser }>('/api/auth/me'),
      apiFetch<SupervisorReviewView | null>(`/api/videos/${params.id}/supervisor-review/latest`),
    ]);
    if (!active.current) return;
    if (userResult.status === 'fulfilled') setCurrentUser(userResult.value.user);
    if (supervisorResult.status === 'fulfilled') setSupervisorReview(supervisorResult.value);
  }, [params.id]);

  useEffect(() => {
    active.current = true;
    loadVideo().catch(() => { if (active.current) setError('详情暂时无法加载，请检查网络后重试。'); });
    return () => { active.current = false; };
  }, [loadVideo]);

  const running = contentReview?.status === 'running' || video?.status === 'ai_content_reviewing';
  const pollingId = trackedReviewId ?? (running ? contentReview?.id : undefined);
  useEffect(() => {
    if (!pollingId) return;
    setPollPause(null);
    return startStatusPolling<{ review: ContentReview | null; videoStatus: string }>({
      load: (signal) => apiFetch(`/api/videos/${params.id}/content-reviews/${pollingId}`, { signal, cache: 'no-store' }),
      isTerminal: (value) => Boolean(value.review && ['succeeded', 'failed'].includes(value.review.status)),
      onValue: (value) => {
        setLatestError('');
        setContentReview(value.review);
        setVideo((current) => current ? { ...current, status: value.videoStatus } : current);
      },
      onTerminal: () => {
        setTrackedReviewId(null);
        void loadVideo().catch(() => { if (active.current) setLatestError('结果已更新，部分详情同步失败，请重新查询。'); });
      },
      onError: () => setLatestError('状态查询暂时失败，正在有限重试；后台评估不受影响。'),
      onPause: setPollPause,
    });
  }, [pollingId, pollAttempt, params.id, loadVideo]);

  async function triggerContentReview() {
    if (triggering.current || running) return;
    triggering.current = true;
    setReviewLoading(true);
    setReviewError('');
    try {
      const started = await apiFetch<{ reviewId: string }>(`/api/videos/${params.id}/content-review`, { method: 'POST' });
      if (!active.current) return;
      pinnedContentReviewId.current = started.reviewId;
      setTrackedReviewId(started.reviewId);
      setVideo((current) => current ? { ...current, status: 'ai_content_reviewing' } : current);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : '内容评估失败');
      await loadVideo().catch(() => undefined);
    } finally {
      triggering.current = false;
      setReviewLoading(false);
    }
  }

  if (error) {
    return (
      <main className="page">
        <p className="error">{error}</p>
        <button className="button" onClick={() => void loadVideo().catch(() => setError('详情暂时无法加载，请稍后重试。'))}>重新加载详情</button>
        <Link className="button secondary" href="/videos">返回列表</Link>
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

  const allowedActions = video.allowedActions || [];
  const canTriggerReview = allowedActions.includes('trigger_content_review');
  const canReview = allowedActions.includes('submit_supervisor_review');
  const canUploadRevision = allowedActions.includes('upload_revision');
  const latestDataReview = video.aiResultReviews?.[0];
  const latestFinal = video.finalVideoEvaluations?.[0];
  const availableActions = allowedActions.filter((action) => action !== 'export_report');
  const navigationTabs = [...new Set(availableActions.map((action) => actionTabs[action]).filter((tab): tab is DetailTab => Boolean(tab)))];
  const workflowIndex = workflowSteps.findIndex((step) => step.statuses.includes(video.status));
  const workflowComplete = ['final_effective', 'final_low_effective', 'final_invalid'].includes(video.status);

  return (
    <main className="page" id="main-content">
      <div className="page-title">
        <div>
          <h1>{video.title}</h1>
          <p className="muted">
            {video.brand || '未填写品牌'} · {video.product || '未填写产品'} · {displayLabel(videoTypeLabels, video.videoType)} · {video.creator?.name || '-'} · {formatShanghaiDateTime(video.createdAt)}
          </p>
          <p className="status-badge">{displayLabel(videoStatusLabels, video.status)}</p>
        </div>
        <Link className="button secondary" href="/videos">
          返回列表
        </Link>
        {allowedActions.includes('export_report') ? <a className="button secondary" href={`/api/videos/${video.id}/report`} download>导出授权报告</a> : null}
      </div>
      <div id="v11-detail-summary" />
      <div className="detail-grid">
        <VideoPlayer videoId={params.id} />
        <aside className="panel">
          <h2>基础信息</h2>
          <p>状态：{displayLabel(videoStatusLabels, video.status)}</p>
          <p>视频类型：{displayLabel(videoTypeLabels, video.videoType)}</p>
          <p>品牌：{video.brand || '-'}</p>
          <p>产品：{video.product || '-'}</p>
          <p>平台：{video.platform || '-'}</p>
          <p>用于投放：{video.isForAds ? '是' : '否'}</p>
          <p>节点视频：{video.isEventVideo ? '是' : '否'}</p>
          <p>节点名称：{video.eventName || '-'}</p>
        </aside>
      </div>
      <details className="legacy-summary section-gap">
        <summary>历史评估摘要</summary>
      <section className="grade-summary" aria-label="三级评估摘要">
        <article><span>内容质量 · 历史评估</span><strong>{contentReview?.status === 'succeeded' ? contentReview.contentGrade || '待确认' : '待评估'}</strong><small>历史内容分：{contentReview?.totalScore ?? '-'} · V1.1 结论见下方独立面板</small></article>
        <article><span>数据表现等级</span><strong>{latestDataReview?.status === 'succeeded' ? latestDataReview.dataGrade || '数据不足' : '待复盘'}</strong><small>GPT/千问运营投放数据复盘</small></article>
        <article><span>最终有效等级</span><strong>{latestFinal?.finalGrade ? displayLabel(finalGradeLabels, latestFinal.finalGrade) : latestFinal?.recommendedFinalGrade ? `${displayLabel(finalGradeLabels, latestFinal.recommendedFinalGrade)}（建议）` : '待负责人确认'}</strong><small>规则引擎 + AI 建议 + 负责人确认</small></article>
      </section>
      </details>
      <section className="detail-next-action" aria-label={availableActions.length > 1 ? '当前可执行操作' : availableActions.length === 1 ? '下一步' : '暂无可执行操作'}>
        <h2>{availableActions.length > 1 ? '当前可执行操作' : availableActions.length === 1 ? '下一步' : '暂无可执行操作'}</h2>
        {availableActions.length ? <ul>{availableActions.map((action, index) => <li key={`${action}-${index}`}>{actionLabels[action] || action}</li>)}</ul> : <p>{nextActionText([], video.status)}</p>}
        <div className="button-row">{navigationTabs.map((tab) => <button key={tab} type="button" className="button" onClick={() => setActiveTab(tab)}>前往{detailTabs.find(([value]) => value === tab)?.[1]}</button>)}</div>
        <small>版本 V{video.version || 1}{video.isTrial ? ' · 试用数据' : ''} · 更新于 {new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short' }).format(new Date(video.updatedAt || video.createdAt))}</small>
      </section>
      <ol className="workflow-stepper" aria-label="评估流程">
        {workflowSteps.map((step, index) => <li key={step.label} aria-current={index === workflowIndex && !workflowComplete ? 'step' : undefined} data-state={workflowComplete || (workflowIndex >= 0 && index < workflowIndex) ? 'completed' : index === workflowIndex ? video.status.endsWith('_failed') ? 'failed' : 'current' : 'waiting'}><span>{step.label}</span><small>{workflowComplete || (workflowIndex >= 0 && index < workflowIndex) ? '已完成' : index === workflowIndex ? displayLabel(videoStatusLabels, video.status) : '待处理'}</small></li>)}
      </ol>
      <nav className="detail-tabs" aria-label="视频评估详情" role="tablist">
        {detailTabs.map(([value, label], index) => <button key={value} id={`detail-tab-${value}`} type="button" role="tab" tabIndex={activeTab === value ? 0 : -1} className={activeTab === value ? 'active' : ''} aria-selected={activeTab === value} aria-controls={`detail-panel-${value}${value === 'content' ? ' detail-panel-supervisor' : value === 'metrics' ? ' detail-panel-result' : value === 'final' ? ' detail-panel-confirmation' : ''}`} onClick={() => setActiveTab(value)} onKeyDown={(event) => {
          const target = event.key === 'Home' ? 0 : event.key === 'End' ? detailTabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % detailTabs.length : event.key === 'ArrowLeft' ? (index + detailTabs.length - 1) % detailTabs.length : -1;
          if (target < 0) return;
          event.preventDefault();
          setActiveTab(detailTabs[target][0]);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus();
        }}>{label}</button>)}
      </nav>
      <div id="detail-panel-content" role="tabpanel" aria-labelledby="detail-tab-content" hidden={activeTab !== 'content'}>
      <V11EvaluationPanel videoId={video.id} />
      <details className="panel section-gap">
        <summary>历史评估</summary>
        <p className="muted">历史评分体系，仅用于历史记录，不参与当前 V1.1 正式结论。</p>
        <div className="page-title">
          <div>
            <h2>Qwen-Omni 内容评估</h2>
            <p className="muted">
              {contentReview ? displayLabel(reviewStatusLabels, contentReview.status) : '未评估'}
            </p>
          </div>
          {canTriggerReview ? (
            <button className="button" type="button" onClick={triggerContentReview} disabled={reviewLoading}>
              {reviewLoading ? '评估中...' : '触发内容评估'}
            </button>
          ) : null}
        </div>
        {reviewError ? <p className="error">{reviewError}</p> : null}
        {running ? <p className="muted" role="status">内容评估正在后台执行，无需刷新页面。离开页面不会取消任务。</p> : null}
        {pollPause ? <p className="warning-list" role="status">{pollPause === 'timeout' ? '已达到本次自动查询时限。' : '网络不稳定，已暂停自动查询。'} 后台任务状态以查询结果为准，不会因本提示被判为失败。</p> : null}
        {pollPause || latestError || (running && !pollingId) ? <button className="button secondary" type="button" onClick={() => {
          if (pollingId) setPollAttempt((value) => value + 1);
          else void loadVideo().catch(() => setLatestError('查询失败，请稍后重试。'));
        }}>重新查询状态</button> : null}
        {latestError ? <p className="error">{latestError}</p> : null}
        {contentReview?.status === 'failed' ? <p className="error">{userFacingErrorMessage(contentReview.errorMessage, '内容评估失败，请稍后重试。')}</p> : null}
        {contentReview?.status === 'succeeded' ? (
          <div>
            <p>内容总分：{contentReview.totalScore ?? '-'}</p>
            <p>内容等级：{contentReview.contentGrade || '-'}</p>
            {contentReview.scoreCalculation === 'backend_deterministic' ? (
              <p className="muted">评分规则：{contentReview.scoringVersion || 'content-score-v2'} · 总分由后端规则计算</p>
            ) : (
              <p className="muted">历史模型评分（{contentReview.scoringVersion || 'legacy-model-score-v1'}）</p>
            )}
            <p>建议发布：{contentReview.isPublishableRecommendation ? '是' : '否'}</p>
            <p>内容摘要：{contentReview.contentSummary || '-'}</p>
            <h3>维度评分</h3>
            <ul>
              {contentReview.scores.map((score) => (
                <li key={score.id}>{displayLabel(contentDimensionLabels, score.dimension)}：{score.score}/{score.maxScore}，{score.comment || '-'}</li>
              ))}
            </ul>
            <h3>主要问题</h3>
            <ul>
              {(contentReview.mainProblems || []).map((problem, index) => (
                <li key={`${problem.dimension}-${index}`}>{problem.dimension}：{problem.description}（严重程度：{displayLabel(severityLabels, problem.severity)}）</li>
              ))}
            </ul>
            <h3>修改建议</h3>
            <ul>
              {(contentReview.revisionSuggestions || []).map((suggestion, index) => (
                <li key={`${suggestion.problem}-${index}`}>{suggestion.problem}：{suggestion.suggestion}（{displayLabel(priorityLabels, suggestion.priority)}）</li>
              ))}
            </ul>
            <h3>合规风险</h3>
            <ul>
              {(contentReview.complianceRisks || []).map((risk, index) => (
                <li key={`${risk.riskType}-${index}`}>{risk.riskType}：{risk.description}{risk.severity ? `（严重程度：${displayLabel(severityLabels, risk.severity)}）` : ''}</li>
              ))}
            </ul>
            <h3>可使用场景</h3>
            <p>{(contentReview.usableScenarios || []).join('、') || '-'}</p>
          </div>
        ) : null}
        {currentUser?.role === 'admin' ? <details className="section-gap"><summary>技术详情</summary><dl><dt>Review ID</dt><dd>{contentReview?.id || '-'}</dd><dt>Model Provider</dt><dd>{contentReview?.modelProvider || '-'}</dd><dt>Model Name</dt><dd>{contentReview?.modelName || '-'}</dd><dt>Prompt Version</dt><dd>{contentReview?.promptVersion || '-'}</dd><dt>Scoring Version</dt><dd>{contentReview?.scoringVersion || '-'}</dd></dl></details> : null}
      </details>
      </div>
      <div id="detail-panel-supervisor" role="region" aria-label="主管审核" hidden={activeTab !== 'content'}>
      <h2>主管审核</h2>
      <SupervisorReviewPanel
        videoId={video.id}
        canReview={canReview}
        review={supervisorReview || video.supervisorReview || null}
        onCompleted={loadVideo}
      />
      {canUploadRevision && (supervisorReview || video.supervisorReview) ? (
        <VideoRevisionPanel
          parentVideoId={video.id}
          comment={(supervisorReview || video.supervisorReview)?.comment || null}
          requirements={(supervisorReview || video.supervisorReview)?.revisionRequirements || []}
        />
      ) : null}
      </div>
      <div id="detail-panel-versions" role="tabpanel" aria-labelledby="detail-tab-versions" hidden={activeTab !== 'versions'}>
      <h2>版本历史</h2>
      <VideoVersionChain
        currentId={video.id}
        chain={video.versionChain || []}
        parent={video.parentVideo || null}
        revisions={video.revisions || []}
      />
      </div>
      <div id="detail-panel-metrics" role="tabpanel" aria-labelledby="detail-tab-metrics" hidden={activeTab !== 'metrics'}>
      <h2>运营投放数据</h2>
      <ResultMetricsPanel
        videoId={video.id}
        videoType={video.videoType}
        isForAds={video.isForAds}
        videoStatus={video.status}
        currentUser={currentUser}
        onVideoRefresh={loadVideo}
        allowedActions={allowedActions}
      />
      </div>
      <div id="detail-panel-result" role="region" aria-label="数据复盘" hidden={activeTab !== 'metrics'}>
      <h2>数据复盘</h2>
      <ResultReviewPanel
        videoId={video.id}
        videoType={video.videoType}
        isForAds={video.isForAds}
        videoStatus={video.status}
        currentUser={currentUser}
        onVideoRefresh={loadVideo}
        allowedActions={allowedActions}
        latestResultMetricId={video.latestResultMetricId}
      />
      </div>
      <div id="detail-panel-final" role="tabpanel" aria-labelledby="detail-tab-final" hidden={activeTab !== 'final'}>
      <h2>规则与最终建议</h2>
      <RuleEnginePanel
        videoId={video.id}
        videoStatus={video.status}
        currentUser={currentUser}
        onVideoRefresh={loadVideo}
        allowedActions={allowedActions}
      />
      <FinalEvaluationPanel
        videoId={video.id}
        videoStatus={video.status}
        currentUser={currentUser}
        onVideoRefresh={loadVideo}
        allowedActions={allowedActions}
      />
      </div>
      <div id="detail-panel-confirmation" role="region" aria-label="负责人确认" hidden={activeTab !== 'final'}>
      <h2>负责人确认</h2>
      <FinalConfirmationPanel
        videoId={video.id}
        videoStatus={video.status}
        currentUser={currentUser}
        onVideoRefresh={loadVideo}
        allowedActions={allowedActions}
      />
      </div>
      <div id="detail-panel-logs" role="tabpanel" aria-labelledby="detail-tab-logs" hidden={activeTab !== 'logs'}>
      <section className="panel section-gap">
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
                <td>{displayLabel(operationLogActionLabels, log.actionType)}</td>
                <td>{operationLogDescription(log.actionType, log.comment)}</td>
                <td>{formatShanghaiDateTime(log.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      </div>
    </main>
  );
}
