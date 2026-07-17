import { ApiUser } from './api';

export type SupervisorDecision =
  | 'approved_for_publish'
  | 'revision_required'
  | 'invalid_content';

export function canSubmitSupervisorReview(user: ApiUser | null, videoStatus: string) {
  return Boolean(
    user &&
      videoStatus === 'pending_supervisor_review' &&
      ['admin', 'content_owner', 'supervisor'].includes(user.role),
  );
}

export function validateSupervisorReview(decision: SupervisorDecision, comment: string) {
  if (decision === 'revision_required' && !comment.trim()) return '请填写返修意见。';
  if (decision === 'invalid_content' && !comment.trim()) return '请填写内容无效原因。';
  return null;
}

export async function submitSupervisorReview(
  request: (path: string, init?: RequestInit) => Promise<unknown>,
  videoId: string,
  input: { decision: SupervisorDecision; comment: string; revisionRequirements: string[] },
  confirmSubmission: () => boolean,
) {
  const validationError = validateSupervisorReview(input.decision, input.comment);
  if (validationError) throw new Error(validationError);
  if (!confirmSubmission()) return null;
  return request(`/api/videos/${videoId}/supervisor-review`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
