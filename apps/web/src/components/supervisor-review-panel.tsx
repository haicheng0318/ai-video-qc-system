'use client';

import { FormEvent, useState } from 'react';
import { apiFetch } from '@/lib/api';
import {
  submitSupervisorReview,
  SupervisorDecision,
  validateSupervisorReview,
} from '@/lib/supervisor-review-ui';

export type SupervisorReviewView = {
  id: string;
  decision: SupervisorDecision;
  comment: string | null;
  revisionRequirements: string[];
  reviewedAt: string;
  reviewer: { name: string; account: string; role: string };
};

const decisions: Array<{ value: SupervisorDecision; label: string }> = [
  { value: 'approved_for_publish', label: '通过发布' },
  { value: 'revision_required', label: '要求返修' },
  { value: 'invalid_content', label: '内容无效' },
];

const decisionLabels = Object.fromEntries(decisions.map((item) => [item.value, item.label]));

export function SupervisorReviewPanel({
  videoId,
  canReview,
  review,
  onCompleted,
}: {
  videoId: string;
  canReview: boolean;
  review: SupervisorReviewView | null;
  onCompleted: () => Promise<void>;
}) {
  const [decision, setDecision] = useState<SupervisorDecision>('approved_for_publish');
  const [comment, setComment] = useState('');
  const [requirements, setRequirements] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateSupervisorReview(decision, comment);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const result = await submitSupervisorReview(
        apiFetch,
        videoId,
        {
          decision,
          comment,
          revisionRequirements: requirements.split('\n').map((item) => item.trim()).filter(Boolean),
        },
        () => window.confirm(`确认提交“${decisionLabels[decision]}”决定？提交后不可重复审核。`),
      );
      if (result) await onCompleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : '主管审核提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel section-gap">
      <h2>主管初审</h2>
      {review ? (
        <div className="review-result">
          <p><strong>审核结果：</strong>{decisionLabels[review.decision] || review.decision}</p>
          <p><strong>审核人：</strong>{review.reviewer.name}（{review.reviewer.account}）</p>
          <p><strong>审核时间：</strong>{new Date(review.reviewedAt).toLocaleString()}</p>
          <p><strong>审核意见：</strong>{review.comment || '-'}</p>
          {review.revisionRequirements.length > 0 ? (
            <ul>{review.revisionRequirements.map((item) => <li key={item}>{item}</li>)}</ul>
          ) : null}
        </div>
      ) : canReview ? (
        <form className="form-grid" onSubmit={onSubmit}>
          <div className="form-field full">
            <label>审核决定</label>
            <div className="segmented-control">
              {decisions.map((item) => (
                <button
                  className={decision === item.value ? 'active' : ''}
                  key={item.value}
                  type="button"
                  onClick={() => setDecision(item.value)}
                  disabled={submitting}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="form-field full">
            <label htmlFor="supervisor-comment">
              {decision === 'revision_required' ? '返修意见' : decision === 'invalid_content' ? '无效原因' : '审核意见'}
            </label>
            <textarea
              id="supervisor-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              required={decision !== 'approved_for_publish'}
              maxLength={4000}
            />
          </div>
          {decision === 'revision_required' ? (
            <div className="form-field full">
              <label htmlFor="revision-requirements">返修要求（每行一项）</label>
              <textarea
                id="revision-requirements"
                value={requirements}
                onChange={(event) => setRequirements(event.target.value)}
              />
            </div>
          ) : null}
          {error ? <p className="error full">{error}</p> : null}
          <div className="form-field full">
            <button className="button" type="submit" disabled={submitting}>
              {submitting ? '提交中' : '提交主管初审'}
            </button>
          </div>
        </form>
      ) : (
        <p className="muted">当前没有主管审核结果。</p>
      )}
    </section>
  );
}
