import type { ReactNode } from 'react';

export type StatusTone = 'completed' | 'processing' | 'waiting' | 'hold' | 'appeal' | 'failed' | 'neutral';

const tones: Record<string, StatusTone> = {
  completed: 'completed', succeeded: 'completed', processing: 'processing', running: 'processing',
  waiting: 'waiting', failed: 'failed', invalid: 'failed', not_started: 'neutral',
  submitted: 'neutral', ai_content_reviewing: 'processing', ai_result_reviewing: 'processing',
  pending_rule_engine: 'processing', pending_final_evaluation: 'processing',
  pending_supervisor_review: 'waiting', pending_final_confirmation: 'waiting',
  pending_result_data: 'waiting', pending_data: 'waiting', revision_required: 'waiting',
  approved_for_publish: 'completed', final_effective: 'completed', final_low_effective: 'completed',
  final_invalid: 'failed', invalid_content: 'failed', ai_content_failed: 'failed',
  ai_result_failed: 'failed', final_evaluation_failed: 'failed', hold: 'hold', appeal: 'appeal',
};

export function StatusBadge({ status, label, children, tone, className = '' }: {
  status?: string; label?: ReactNode; children?: ReactNode; tone?: StatusTone; className?: string;
}) {
  return <span className={`status-badge status-${tone ?? tones[(status ?? '').toLowerCase()] ?? 'neutral'} ${className}`}>{children ?? label ?? status ?? '未开始'}</span>;
}

const gradeClasses: Record<string, string> = { S: 's', 'A+': 'a-plus', A: 'a', B: 'b', 'B-': 'b-minus', C: 'c', D: 'd' };

export function GradeBadge({ grade, emptyLabel = '未评定', className = '' }: { grade?: string | null; emptyLabel?: string; className?: string }) {
  return <span className={`grade-badge grade-${gradeClasses[grade ?? ''] ?? 'unknown'} ${className}`} aria-label={`等级 ${grade || emptyLabel}`}>{grade || emptyLabel}</span>;
}
