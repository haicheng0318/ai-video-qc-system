import { getResultMetricFieldConfig, VideoType } from '@ai-video-qc/shared';
import { ApiRequestError, ApiUser } from './api';
import { ResultMetricSnapshot } from './result-metrics-ui';

export type ResultReview = {
  id: string;
  resultMetricId: string;
  modelProvider: string;
  modelName: string;
  dataScore: number | null;
  dataGrade: string | null;
  dataSufficiency: 'sufficient' | 'insufficient' | 'pending';
  isBusinessEffectiveRecommendation: boolean | null;
  resultSummary: string | null;
  performanceProblems: Array<{
    metric: string;
    severity: string;
    observedValue: string | null;
    benchmarkValue: string | null;
    description: string;
  }>;
  attributionAnalysis: Array<{
    type: string;
    confidence: number;
    evidence: string[];
    conclusion: string;
  }>;
  optimizationSuggestions: Array<{
    priority: string;
    owner: string;
    action: string;
    rationale: string;
  }>;
  sufficiencyReasons: Array<{
    code: string;
    description: string;
    requiredNextData: string[];
  }>;
  continueTestRecommendation: string | null;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  errorMessage: string | null;
  createdAt: string;
};

export type ResultReviewLatest = { videoStatus: string; review: ResultReview | null };
export type ResultReviewHistory = {
  items: Array<ResultReview & {
    isLatest: boolean;
    dataPeriod: { start: string | null; end: string | null };
  }>;
  nextCursor: string | null;
};

const triggerStatuses = new Set(['pending_result_data', 'ai_result_failed']);

export function canTriggerResultReview(
  user: ApiUser | null,
  videoType: VideoType,
  isForAds: boolean,
  videoStatus: string,
  latestMetric: ResultMetricSnapshot | null,
  review: ResultReview | null,
) {
  if (!user || !latestMetric || !triggerStatuses.has(videoStatus) || review?.status === 'running') return false;
  if (review?.status === 'succeeded' && review.resultMetricId === latestMetric.id) return false;
  if (user.role === 'admin' || user.role === 'content_owner') return true;
  return user.role === getResultMetricFieldConfig(videoType, isForAds).responsibleRole;
}

export function shouldDisplayResultScore(
  review: ResultReview | null,
): review is ResultReview & { dataScore: number; dataGrade: string } {
  return review?.status === 'succeeded' &&
    review.dataSufficiency === 'sufficient' &&
    review.dataScore !== null &&
    review.dataGrade !== null;
}

export function resultReviewErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 409) {
    return '当前数据快照或复盘状态已变化，请重新加载。';
  }
  if (error instanceof ApiRequestError && error.status === 403) {
    return '当前角色没有触发数据复盘的权限。';
  }
  return error instanceof Error ? error.message : 'GPT 数据复盘请求失败';
}

export async function triggerResultReview(
  request: (path: string, init: RequestInit) => Promise<{
    reviewId: string;
    resultMetricId: string;
    status: 'running';
    videoStatus: string;
  }>,
  videoId: string,
  resultMetricId: string,
) {
  return request(`/api/videos/${videoId}/result-review`, {
    method: 'POST',
    body: JSON.stringify({ resultMetricId }),
  });
}

export async function loadResultReviewRequests(options: {
  loadMetric: () => Promise<ResultMetricSnapshot | null>;
  loadLatest: () => Promise<ResultReviewLatest>;
  loadHistory: () => Promise<ResultReviewHistory>;
  onMetric: (value: ResultMetricSnapshot | null) => void;
  onLatest: (value: ResultReviewLatest) => void;
  onHistory: (value: ResultReviewHistory) => void;
  onMetricError: () => void;
  onLatestError: () => void;
  onHistoryError: () => void;
}) {
  const [metric, latest, history] = await Promise.allSettled([
    options.loadMetric(),
    options.loadLatest(),
    options.loadHistory(),
  ]);
  if (metric.status === 'fulfilled') options.onMetric(metric.value);
  else options.onMetricError();
  if (latest.status === 'fulfilled') options.onLatest(latest.value);
  else options.onLatestError();
  if (history.status === 'fulfilled') options.onHistory(history.value);
  else options.onHistoryError();
}

export function startResultReviewPolling(options: {
  loadLatest: () => Promise<ResultReviewLatest>;
  onLatest: (value: ResultReviewLatest) => void;
  onTerminal: (value: ResultReviewLatest) => void | Promise<void>;
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
      if (latest.review && ['succeeded', 'failed'].includes(latest.review.status)) {
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
