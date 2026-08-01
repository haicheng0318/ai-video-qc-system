import {
  RULE_ENGINE_VERSION,
  RuleEngineHistoryResponse,
  RuleEngineLatestResponse,
} from '@ai-video-qc/shared';
import { ApiRequestError, ApiUser } from './api';
import { ResultReviewLatest } from './result-review-ui';

export function canExecuteRuleEngine(
  user: ApiUser | null,
  videoStatus: string,
  resultReview: ResultReviewLatest['review'],
  latest: RuleEngineLatestResponse['ruleEngineResult'],
) {
  return Boolean(
    user &&
    (user.role === 'admin' || user.role === 'content_owner') &&
    videoStatus === 'pending_rule_engine' &&
    resultReview?.status === 'succeeded' &&
    latest?.ruleVersion !== RULE_ENGINE_VERSION,
  );
}

export function ruleEngineErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 409) {
    return '规则来源或视频状态已变化，请重新加载后再执行。';
  }
  if (error instanceof ApiRequestError && error.status === 403) {
    return '当前角色没有执行规则判断的权限。';
  }
  if (error instanceof ApiRequestError && error.status === 422) {
    return '内容等级、数据等级或数据充分性不符合规则输入要求。';
  }
  return error instanceof Error ? error.message : '规则判断请求失败';
}

export async function executeRuleEngine(
  request: (path: string, init: RequestInit) => Promise<RuleEngineLatestResponse>,
  videoId: string,
  resultReviewId: string,
) {
  return request(`/api/videos/${videoId}/rule-engine`, {
    method: 'POST',
    body: JSON.stringify({ resultReviewId }),
  });
}

export async function loadRuleEngineRequests(options: {
  loadResultReview: () => Promise<ResultReviewLatest>;
  loadLatest: () => Promise<RuleEngineLatestResponse>;
  loadHistory: () => Promise<RuleEngineHistoryResponse>;
  onResultReview: (value: ResultReviewLatest) => void;
  onLatest: (value: RuleEngineLatestResponse) => void;
  onHistory: (value: RuleEngineHistoryResponse) => void;
  onResultReviewError: () => void;
  onLatestError: () => void;
  onHistoryError: () => void;
}) {
  await Promise.all([
    options.loadResultReview().then(options.onResultReview, options.onResultReviewError),
    options.loadLatest().then(options.onLatest, options.onLatestError),
    options.loadHistory().then(options.onHistory, options.onHistoryError),
  ]);
}
