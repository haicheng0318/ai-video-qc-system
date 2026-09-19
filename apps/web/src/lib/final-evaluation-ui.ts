import {
  FINAL_EVALUATION_VERSION,
  FinalEvaluationHistoryResponse,
  FinalEvaluationLatestResponse,
  RuleEngineLatestResponse,
} from '@ai-video-qc/shared';
import { ApiRequestError, ApiUser } from './api';
import { PollingPauseReason, startStatusPolling } from './status-polling';

export function canTriggerFinalEvaluation(
  user: ApiUser | null,
  videoStatus: string,
  ruleLatest: RuleEngineLatestResponse['ruleEngineResult'],
  latest: FinalEvaluationLatestResponse['evaluation'],
) {
  return Boolean(
    user &&
    (user.role === 'admin' || user.role === 'content_owner') &&
    ['pending_final_evaluation', 'final_evaluation_failed'].includes(videoStatus) &&
    ruleLatest?.dataSufficiency === 'sufficient' &&
    latest?.status !== 'running' &&
    !(latest?.status === 'succeeded' &&
      latest.ruleEngineResultId === ruleLatest?.id &&
      latest.evaluationVersion === FINAL_EVALUATION_VERSION),
  );
}

export function finalEvaluationErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 403) return '当前角色没有生成最终评定建议的权限。';
  if (error instanceof ApiRequestError && error.status === 409) return '来源或视频状态已变化，请重新加载后再试。';
  if (error instanceof ApiRequestError && error.status === 422) return '来源等级或规则边界校验失败，无法生成建议。';
  return error instanceof Error ? error.message : '最终评定建议请求失败';
}

export function triggerFinalEvaluation(
  request: (path: string, init: RequestInit) => Promise<any>,
  videoId: string,
  ruleEngineResultId: string,
) {
  return request(`/api/videos/${videoId}/final-evaluation`, {
    method: 'POST',
    body: JSON.stringify({ ruleEngineResultId }),
  });
}

export function startFinalEvaluationJobPolling(options: {
  videoId: string; jobId: string; evaluationId: string;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  onEvaluation: (value: FinalEvaluationLatestResponse) => void;
  onPause: (reason: PollingPauseReason) => void;
  onError?: () => void;
  intervalMs?: number; maxDurationMs?: number; maxErrors?: number;
  schedule?: (task: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  return startStatusPolling<{ status: string; stage: string; evaluationId?: string | null }>({
    load: (signal) => options.request(`/api/evaluation-jobs/${options.jobId}`, { signal, cache: 'no-store' }),
    isTerminal: (job) => !['queued', 'running', 'retry_wait'].includes(job.status), onValue: () => undefined,
    onTerminal: async (job) => {
      if (job.stage !== 'final' || job.evaluationId !== options.evaluationId) return options.onPause('network');
      try { options.onEvaluation(await options.request(`/api/videos/${options.videoId}/final-evaluations/${options.evaluationId}`, { cache: 'no-store' })); }
      catch { options.onError?.(); options.onPause('network'); }
    },
    onPause: options.onPause, onError: options.onError,
    intervalMs: options.intervalMs, maxDurationMs: options.maxDurationMs, maxErrors: options.maxErrors,
    schedule: options.schedule as typeof setTimeout, cancel: options.cancel as typeof clearTimeout,
  });
}

export async function loadFinalEvaluationRequests(options: {
  loadRule: () => Promise<RuleEngineLatestResponse>;
  loadLatest: () => Promise<FinalEvaluationLatestResponse>;
  loadHistory: () => Promise<FinalEvaluationHistoryResponse>;
  onRule: (value: RuleEngineLatestResponse) => void;
  onLatest: (value: FinalEvaluationLatestResponse) => void;
  onHistory: (value: FinalEvaluationHistoryResponse) => void;
  onRuleError: () => void;
  onLatestError: () => void;
  onHistoryError: () => void;
}) {
  await Promise.all([
    options.loadRule().then(options.onRule, options.onRuleError),
    options.loadLatest().then(options.onLatest, options.onLatestError),
    options.loadHistory().then(options.onHistory, options.onHistoryError),
  ]);
}

export function startFinalEvaluationPolling(options: {
  loadLatest: () => Promise<FinalEvaluationLatestResponse>;
  onLatest: (value: FinalEvaluationLatestResponse) => void;
  onTerminal: (value: FinalEvaluationLatestResponse) => void | Promise<void>;
  onError: () => void;
  intervalMs?: number;
  maxErrors?: number;
  schedule?: (task: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  let stopped = false;
  let errors = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = options.schedule || setTimeout;
  const cancel = options.cancel || clearTimeout;
  const tick = async () => {
    if (stopped) return;
    try {
      const latest = await options.loadLatest();
      if (stopped) return;
      errors = 0;
      options.onLatest(latest);
      if (latest.evaluation && ['succeeded', 'failed'].includes(latest.evaluation.status)) {
        stopped = true;
        await options.onTerminal(latest);
        return;
      }
    } catch {
      errors += 1;
      options.onError();
      if (errors >= (options.maxErrors || 5)) {
        stopped = true;
        return;
      }
    }
    if (!stopped) timer = schedule(() => { void tick(); }, options.intervalMs || 2500);
  };
  timer = schedule(() => { void tick(); }, options.intervalMs || 2500);
  return () => {
    stopped = true;
    if (timer) cancel(timer);
  };
}
