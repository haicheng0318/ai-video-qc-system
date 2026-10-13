import { V11ContentDimension } from './content-scoring';

export const V11_FACT_CLAIM_VERSION = 'fact-claims-v1.1-v2';

export const V11_FACT_CLAIMS = {
  opening_hook: ['hook_present', 'topic_clear_in_opening'],
  selling_point: ['core_subject_identifiable', 'selling_point_present', 'selling_point_supported'],
  structure: ['mainline_coherent', 'closing_present'],
  visual_quality: ['key_subject_visible', 'critical_visual_issue_present'],
  pacing: ['critical_pacing_issue_present'],
  subtitle_audio: ['audio_present', 'subtitle_present', 'critical_audio_text_issue_present'],
  platform_fit: ['declared_platform_fit'],
  action_logic: ['action_cue_present', 'action_cue_consistent'],
} as const satisfies Record<V11ContentDimension, readonly string[]>;

export type V11FactClaimKey = (typeof V11_FACT_CLAIMS)[V11ContentDimension][number];

export function isV11FactClaimKey(dimension: V11ContentDimension, key: string): key is V11FactClaimKey {
  return (V11_FACT_CLAIMS[dimension] as readonly string[]).includes(key);
}
