import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VideoVersionChain } from '../components/video-version-chain';
import {
  canSubmitSupervisorReview,
  submitSupervisorReview,
  validateSupervisorReview,
} from '../lib/supervisor-review-ui';
import { submitVideoRevision } from '../lib/video-revision-ui';

test('supervisor form permission and required reason validation follow phase 3 rules', () => {
  assert.equal(canSubmitSupervisorReview({ id: 's', name: 'S', account: 's', role: 'supervisor' }, 'pending_supervisor_review'), true);
  assert.equal(canSubmitSupervisorReview({ id: 'd', name: 'D', account: 'd', role: 'director' }, 'pending_supervisor_review'), false);
  assert.equal(validateSupervisorReview('revision_required', ''), '请填写返修意见。');
  assert.equal(validateSupervisorReview('invalid_content', '  '), '请填写内容无效原因。');
  assert.equal(validateSupervisorReview('approved_for_publish', ''), null);
});

test('supervisor submission validates before request and respects confirmation', async () => {
  let requests = 0;
  const request = async () => {
    requests += 1;
    return { id: 'review' };
  };
  await assert.rejects(
    submitSupervisorReview(request, 'video', {
      decision: 'revision_required', comment: '', revisionRequirements: [],
    }, () => true),
    /请填写返修意见/,
  );
  const cancelled = await submitSupervisorReview(request, 'video', {
    decision: 'approved_for_publish', comment: '', revisionRequirements: [],
  }, () => false);
  assert.equal(cancelled, null);
  assert.equal(requests, 0);
});

test('revision upload navigates to the newly created video detail', async () => {
  let navigated = '';
  const result = await submitVideoRevision(
    async () => ({ id: 'new-video-id' }),
    'parent-video-id',
    new FormData(),
    (path) => { navigated = path; },
  );
  assert.equal(result.id, 'new-video-id');
  assert.equal(navigated, '/videos/new-video-id');
});

test('version chain renders previous, current and direct revision links', () => {
  const html = renderToStaticMarkup(React.createElement(VideoVersionChain, {
    currentId: 'v2',
    chain: [
      { id: 'v1', title: 'V1', status: 'revision_required', version: 1 },
      { id: 'v2', title: 'V2', status: 'pending_supervisor_review', version: 2 },
    ],
    parent: { id: 'v1', title: 'V1', status: 'revision_required', version: 1 },
    revisions: [{ id: 'v3', title: 'V3', status: 'submitted', version: 3 }],
  }));
  assert.match(html, /\/videos\/v1/);
  assert.match(html, /\/videos\/v2/);
  assert.match(html, /\/videos\/v3/);
  assert.match(html, /current/);
});
