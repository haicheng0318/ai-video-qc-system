import {
  allowedFinalGrades,
  CaseType,
  FinalEvaluationView,
  FinalGrade,
  RecommendedBoundary,
} from '@ai-video-qc/shared';
import { ApiRequestError, ApiUser } from './api';

export function canConfirmFinalEvaluation(user: ApiUser | null, videoStatus: string, evaluation: FinalEvaluationView | null) {
  return Boolean(user && ['admin', 'content_owner'].includes(user.role) &&
    videoStatus === 'pending_final_confirmation' && evaluation?.status === 'succeeded' && !evaluation.confirmedAt);
}

export function finalConfirmationValidation(input: {
  boundary: RecommendedBoundary;
  finalGrade: FinalGrade;
  recommendedFinalGrade: string | null;
  canBeUsedForPerformance: boolean;
  confirmationComment: string;
  manualAdjustReason: string;
}) {
  if (!allowedFinalGrades(input.boundary).includes(input.finalGrade)) return '所选等级超出规则引擎允许边界。';
  if (input.finalGrade === 'invalid' && input.canBeUsedForPerformance) return '无效视频不能用于绩效参考。';
  const adjusted = input.recommendedFinalGrade !== null && input.finalGrade !== input.recommendedFinalGrade;
  if (adjusted && input.manualAdjustReason.trim().length < 10) return '调整 GPT 建议时，请填写至少 10 个字符的调整原因。';
  if (!adjusted && input.manualAdjustReason.trim()) return '接受 GPT 建议时无需填写调整原因。';
  if (input.boundary === 'require_manual_confirmation' && input.confirmationComment.trim().length < 10) {
    return '该规则边界需要至少 10 个字符的人工确认说明。';
  }
  return null;
}

export function submitFinalConfirmation(request: (path: string, init: RequestInit) => Promise<unknown>, videoId: string, payload: {
  evaluationId: string; finalGrade: FinalGrade; canBeUsedForPerformance: boolean;
  confirmationComment?: string; manualAdjustReason?: string;
}) {
  return request(`/api/videos/${videoId}/final-confirmation`, { method: 'POST', body: JSON.stringify(payload) });
}

export function submitCaseMarking(request: (path: string, init: RequestInit) => Promise<unknown>, videoId: string, payload: {
  evaluationId: string; caseType: CaseType; reason: string;
}) {
  return request(`/api/videos/${videoId}/case-marking`, { method: 'PUT', body: JSON.stringify(payload) });
}

export function finalConfirmationError(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 403) return '当前角色没有执行最终确认的权限。';
  if (error instanceof ApiRequestError && error.status === 409) return '视频或来源已更新，请重新加载后再确认。';
  if (error instanceof ApiRequestError && error.status === 400) return error.message;
  return error instanceof Error ? error.message : '最终确认失败。';
}
