import { UserRole, VideoStatus, VideoType } from '@prisma/client';
import { AuthenticatedUser } from '../../types/authenticated-user';
import { canManageResultData } from '../permissions/permissions.service';

export type VideoAction =
  | 'trigger_content_review'
  | 'submit_supervisor_review'
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
};

export function allowedVideoActions(user: AuthenticatedUser, video: ActionVideo, evidence: ActionEvidence = {}): VideoAction[] {
  const actions: VideoAction[] = [];
  const owner = user.role === UserRole.admin || user.role === UserRole.content_owner;
  const own = video.creatorId === user.id;
  if (new Set<VideoStatus>([VideoStatus.submitted, VideoStatus.ai_content_failed]).has(video.status) &&
    (owner || (own && [UserRole.director, UserRole.visitor].includes(user.role as 'director' | 'visitor')))) actions.push('trigger_content_review');
  if (video.status === VideoStatus.pending_supervisor_review &&
    (owner || (user.role === UserRole.supervisor && (own || video.creatorManagerId === user.id)))) actions.push('submit_supervisor_review');
  if (video.status === VideoStatus.revision_required && (owner || own)) actions.push('upload_revision');
  if (new Set<VideoStatus>([VideoStatus.approved_for_publish, VideoStatus.pending_result_data, VideoStatus.ai_result_failed, VideoStatus.pending_data]).has(video.status) &&
    canManageResultData(user, video as any)) actions.push('submit_result_metrics');
  if (new Set<VideoStatus>([VideoStatus.pending_result_data, VideoStatus.ai_result_failed]).has(video.status) && canManageResultData(user, video as any) && evidence.hasMetric &&
    !evidence.resultReviewRunning && !evidence.resultReviewCurrentSucceeded) actions.push('trigger_result_review');
  if (video.status === VideoStatus.pending_rule_engine && owner && evidence.resultReviewSucceeded && !evidence.ruleCurrent) actions.push('execute_rule_engine');
  if (new Set<VideoStatus>([VideoStatus.pending_final_evaluation, VideoStatus.final_evaluation_failed]).has(video.status) && owner && evidence.ruleSufficient &&
    !evidence.finalRunning && !evidence.finalCurrentSucceeded) actions.push('trigger_final_evaluation');
  if (video.status === VideoStatus.pending_final_confirmation && owner && evidence.finalSucceeded && !evidence.finalConfirmed) actions.push('confirm_final_evaluation');
  if (new Set<VideoStatus>([VideoStatus.final_effective, VideoStatus.final_low_effective, VideoStatus.final_invalid]).has(video.status) && owner && evidence.finalConfirmed) actions.push('mark_case');
  actions.push('export_report');
  return actions;
}
