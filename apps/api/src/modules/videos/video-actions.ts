import { UserRole, VideoRecordState, VideoStatus, VideoType } from '@prisma/client';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { canManageResultData } from '../permissions/permissions.service';

export type VideoAction =
  | 'trigger_content_review'
  | 'upload_revision'
  | 'submit_result_metrics'
  | 'trigger_result_review'
  | 'execute_rule_engine'
  | 'trigger_final_evaluation'
  | 'confirm_final_evaluation'
  | 'mark_case'
  | 'export_report';

type ActionVideo = {
  status: VideoStatus;
  creatorId: string;
  creatorManagerId?: string | null;
  videoType: VideoType;
  isForAds: boolean;
  recordState?: VideoRecordState;
};

type ActionEvidence = {
  hasMetric?: boolean;
  resultReviewRunning?: boolean;
  resultReviewCurrentSucceeded?: boolean;
  resultReviewSucceeded?: boolean;
  ruleCurrent?: boolean;
  ruleSufficient?: boolean;
  finalRunning?: boolean;
  finalCurrentSucceeded?: boolean;
  finalSucceeded?: boolean;
  finalConfirmed?: boolean;
  currentFormalV11ContentDecision?: boolean;
  legacyRuleEngineSourceAvailable?: boolean;
};

export function allowedVideoActions(user: AuthenticatedUser, video: ActionVideo, evidence: ActionEvidence = {}): VideoAction[] {
  if (video.recordState && video.recordState !== VideoRecordState.active) return [];
  const actions: VideoAction[] = [];
  const administrator = user.role === UserRole.admin;
  const own = video.creatorId === user.id;
  if (new Set<VideoStatus>([VideoStatus.submitted, VideoStatus.ai_content_failed]).has(video.status) &&
    (administrator || own)) actions.push('trigger_content_review');
  if (video.status === VideoStatus.revision_required && (administrator || own)) actions.push('upload_revision');
  if (new Set<VideoStatus>([VideoStatus.approved_for_publish, VideoStatus.pending_supervisor_review, VideoStatus.pending_result_data, VideoStatus.ai_result_failed, VideoStatus.pending_data]).has(video.status) &&
    canManageResultData(user, video as any)) actions.push('submit_result_metrics');
  if (new Set<VideoStatus>([VideoStatus.pending_result_data, VideoStatus.ai_result_failed]).has(video.status) && canManageResultData(user, video as any) && evidence.hasMetric &&
    !evidence.resultReviewRunning && !evidence.resultReviewCurrentSucceeded) actions.push('trigger_result_review');
  if (video.status === VideoStatus.pending_rule_engine && (administrator || own) && evidence.resultReviewSucceeded && !evidence.ruleCurrent
    && (!evidence.currentFormalV11ContentDecision || evidence.legacyRuleEngineSourceAvailable)) actions.push('execute_rule_engine');
  if (new Set<VideoStatus>([VideoStatus.pending_final_evaluation, VideoStatus.final_evaluation_failed]).has(video.status) && (administrator || own) && evidence.ruleSufficient &&
    !evidence.finalRunning && !evidence.finalCurrentSucceeded) actions.push('trigger_final_evaluation');
  if (video.status === VideoStatus.pending_final_confirmation && (administrator || (own && user.role === UserRole.content_owner)) && evidence.finalSucceeded && !evidence.finalConfirmed) actions.push('confirm_final_evaluation');
  if (new Set<VideoStatus>([VideoStatus.final_effective, VideoStatus.final_low_effective, VideoStatus.final_invalid]).has(video.status) && (administrator || (own && user.role === UserRole.content_owner)) && evidence.finalConfirmed) actions.push('mark_case');
  actions.push('export_report');
  return actions;
}
