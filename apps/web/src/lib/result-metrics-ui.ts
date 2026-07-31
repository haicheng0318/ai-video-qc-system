import {
  getResultMetricFieldConfig,
  resultMetricFieldDefinitions,
  ResultMetricField,
  VideoType,
} from '@ai-video-qc/shared';
import { ApiRequestError, ApiUser } from './api';

export type ResultMetricSnapshot = {
  id: string;
  videoId: string;
  videoType: VideoType;
  submittedBy: { id: string; name: string; account: string; role: string } | null;
  createdAt: string;
  previousMetricId: string | null;
  videoStatus: string;
  dataWarnings: string[];
} & Partial<Record<ResultMetricField, string | number | null>>;

export type ResultMetricHistory = {
  items: Array<ResultMetricSnapshot & { isLatest: boolean }>;
  nextCursor: string | null;
};

const editableStatuses = new Set([
  'approved_for_publish',
  'pending_result_data',
  'ai_result_failed',
  'pending_data',
]);

export function canSubmitResultMetrics(
  user: ApiUser | null,
  videoType: VideoType,
  isForAds: boolean,
  videoStatus: string,
) {
  if (!user || !editableStatuses.has(videoStatus)) return false;
  if (user.role === 'admin' || user.role === 'content_owner') return true;
  return user.role === getResultMetricFieldConfig(videoType, isForAds).responsibleRole;
}

export function createMetricFormValues(
  fields: ResultMetricField[],
  latest: ResultMetricSnapshot | null,
) {
  return Object.fromEntries(
    fields.map((field) => [field, latest?.[field]?.toString() ?? '']),
  ) as Record<ResultMetricField, string>;
}

export function buildResultMetricPayload(
  fields: ResultMetricField[],
  values: Record<ResultMetricField, string>,
  latest: ResultMetricSnapshot | null,
) {
  const payload: Record<string, string | number | null> = {
    baseMetricId: latest?.id ?? null,
  };
  for (const field of fields) {
    const current = values[field]?.trim() ?? '';
    const previous = latest?.[field]?.toString() ?? '';
    if (current === previous) continue;
    const kind = resultMetricFieldDefinitions[field].kind;
    payload[field] =
      current === ''
        ? null
        : ['count', 'money2', 'decimal4', 'percentage', 'roi'].includes(kind)
          ? Number(current)
          : current;
  }
  return payload;
}

export function changedMetricFields(payload: Record<string, unknown>) {
  return Object.keys(payload).filter((field) => field !== 'baseMetricId');
}

export function formatMetricValue(field: ResultMetricField, value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  const definition = resultMetricFieldDefinitions[field];
  if (definition.kind === 'percentage') return `${value}%`;
  if (definition.kind === 'roi') return `${value} 倍`;
  if (definition.kind === 'money2') return `¥${value}`;
  return String(value);
}

export function resultMetricErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 409) {
    return '数据已被其他人更新，请重新加载后再提交。';
  }
  return error instanceof Error ? error.message : '结果数据提交失败';
}

export async function submitResultMetricSnapshot(
  request: (path: string, init: RequestInit) => Promise<unknown>,
  videoId: string,
  payload: Record<string, unknown>,
  reloadMetrics: () => Promise<void>,
  refreshVideo: () => Promise<void>,
) {
  const result = await request(`/api/videos/${videoId}/result-metrics`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  await reloadMetrics();
  await refreshVideo();
  return result;
}

export async function loadResultMetricRequests(options: {
  loadLatest: () => Promise<ResultMetricSnapshot | null>;
  loadHistory: () => Promise<ResultMetricHistory>;
  onLatest: (value: ResultMetricSnapshot | null) => void;
  onHistory: (value: ResultMetricHistory) => void;
  onLatestError: () => void;
  onHistoryError: () => void;
}) {
  const [latest, history] = await Promise.allSettled([
    options.loadLatest(),
    options.loadHistory(),
  ]);
  if (latest.status === 'fulfilled') options.onLatest(latest.value);
  else options.onLatestError();
  if (history.status === 'fulfilled') options.onHistory(history.value);
  else options.onHistoryError();
}
