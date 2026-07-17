export const OperationLogAction = {
  LoginSuccess: 'login_success',
  LoginFailed: 'login_failed',
  PermissionDenied: 'permission_denied',
  VideoUploaded: 'video_uploaded',
  VideoDetailViewed: 'video_detail_viewed',
  VideoFileAccessed: 'video_file_accessed',
  AiContentReviewStarted: 'ai_content_review_started',
  AiContentReviewRecovered: 'ai_content_review_recovered',
  AiContentReviewCompleted: 'ai_content_review_completed',
  AiContentReviewFailed: 'ai_content_review_failed',
  AiContentReviewViewed: 'ai_content_review_viewed',
  SupervisorReviewApproved: 'supervisor_review_approved',
  SupervisorReviewRevisionRequired: 'supervisor_review_revision_required',
  SupervisorReviewInvalidContent: 'supervisor_review_invalid_content',
  SupervisorReviewViewed: 'supervisor_review_viewed',
  VideoRevisionUploaded: 'video_revision_uploaded',
} as const;

export type OperationLogAction = (typeof OperationLogAction)[keyof typeof OperationLogAction];
