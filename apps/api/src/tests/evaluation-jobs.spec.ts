import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotFoundException } from '@nestjs/common';
import {
  classifyEvaluationError,
  EvaluationJobsService,
} from '../modules/evaluation-jobs/evaluation-jobs.service';

test('job query rejects malformed identifiers before database lookup', async () => {
  const jobs = new EvaluationJobsService({ evaluationJob: { findUnique: () => { throw new Error('unsafe lookup'); } } } as any, {} as any);
  await assert.rejects(jobs.get('not-a-uuid', {} as any, {}), NotFoundException);
});

test('nested OSS response timeout is classified as timeout', () => {
  const timeout = Object.assign(new Error('Response timeout for 60000ms'), {
    name: 'ResponseTimeoutError',
  });
  const wrapped = Object.assign(new Error('Qwen content review request failed.'), {
    code: 'CONTENT_REVIEW_REQUEST_FAILED',
    cause: timeout,
  });

  assert.equal(classifyEvaluationError(wrapped), 'timeout');
});

test('deeply nested ETIMEDOUT is classified as timeout', () => {
  const wrapped = Object.assign(new Error('outer failure'), {
    cause: Object.assign(new Error('provider failure'), {
      cause: Object.assign(new Error('socket timeout'), { code: 'ETIMEDOUT' }),
    }),
  });

  assert.equal(classifyEvaluationError(wrapped), 'timeout');
});
