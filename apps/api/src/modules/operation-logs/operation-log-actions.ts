export const OperationLogAction = {
  LoginSuccess: 'login_success',
  LoginFailed: 'login_failed',
  PermissionDenied: 'permission_denied',
  VideoUploaded: 'video_uploaded',
  VideoDetailViewed: 'video_detail_viewed',
  VideoFileAccessed: 'video_file_accessed',
} as const;

export type OperationLogAction = (typeof OperationLogAction)[keyof typeof OperationLogAction];
