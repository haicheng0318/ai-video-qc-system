export const userRoles = [
  'admin',
  'content_owner',
  'supervisor',
  'director',
  'operator',
  'advertiser',
] as const;

export type UserRole = (typeof userRoles)[number];

export const videoTypes = [
  'product_card',
  'qianchuan_ad',
  'live_room_traffic',
  'organic',
  'brand_seeding',
  'other',
] as const;

export type VideoType = (typeof videoTypes)[number];

export const videoStatuses = [
  'submitted',
  'ai_content_reviewing',
  'ai_content_failed',
  'pending_supervisor_review',
  'revision_required',
  'invalid_content',
  'approved_for_publish',
  'pending_result_data',
  'ai_result_reviewing',
  'ai_result_failed',
  'pending_rule_engine',
  'pending_final_evaluation',
  'final_evaluation_failed',
  'pending_final_confirmation',
  'final_effective',
  'final_low_effective',
  'final_invalid',
  'pending_data',
  'excellent_case',
  'negative_case',
] as const;

export type VideoStatus = (typeof videoStatuses)[number];
