import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  CreateSupervisorReviewDto,
  SupervisorReviewDecision,
} from '../modules/supervisor-reviews/dto/create-supervisor-review.dto';

test('supervisor review DTO rejects decisions outside the allowed enum', async () => {
  const dto = plainToInstance(CreateSupervisorReviewDto, { decision: 'pending_result_data' });
  const errors = await validate(dto);
  assert.ok(errors.some((error) => error.property === 'decision'));
});

test('supervisor review DTO accepts the three phase 3 decisions', async () => {
  for (const decision of Object.values(SupervisorReviewDecision)) {
    const dto = plainToInstance(CreateSupervisorReviewDto, { decision });
    assert.equal((await validate(dto)).length, 0);
  }
});
