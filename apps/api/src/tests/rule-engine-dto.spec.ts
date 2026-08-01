import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ExecuteRuleEngineDto } from '../modules/rule-engine/dto/execute-rule-engine.dto';
import { RuleEngineHistoryQueryDto } from '../modules/rule-engine/dto/rule-engine-history-query.dto';

const reviewId = '00000000-0000-4000-8000-000000000201';

for (const value of [undefined, null, '', 'review', '00000000-0000-0000-0000-000000000000']) {
  test(`resultReviewId rejects invalid UUID value ${String(value)}`, async () => {
    const errors = await validate(plainToInstance(ExecuteRuleEngineDto, { resultReviewId: value }));
    assert.ok(errors.length > 0);
  });
}

test('resultReviewId accepts a strict UUID', async () => {
  assert.equal((await validate(plainToInstance(ExecuteRuleEngineDto, { resultReviewId: reviewId }))).length, 0);
});

for (const field of ['contentGrade', 'dataGrade', 'dataSufficiency', 'ruleCode', 'ruleResult', 'ruleVersion', 'videoId']) {
  test(`rule engine DTO rejects mass assignment field ${field}`, async () => {
    const instance = plainToInstance(ExecuteRuleEngineDto, { resultReviewId: reviewId, [field]: 'unsafe' });
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    assert.ok(errors.some((error) => error.property === field));
  });
}

for (const limit of ['0', '51', '-1', '1.5', 'invalid']) {
  test(`history rejects invalid limit ${limit}`, async () => {
    const errors = await validate(plainToInstance(RuleEngineHistoryQueryDto, { limit }));
    assert.ok(errors.length > 0);
  });
}

test('history limit defaults to 20 and accepts 1 through 50', async () => {
  assert.equal(plainToInstance(RuleEngineHistoryQueryDto, {}).limit, 20);
  assert.equal((await validate(plainToInstance(RuleEngineHistoryQueryDto, { limit: '1' }))).length, 0);
  assert.equal((await validate(plainToInstance(RuleEngineHistoryQueryDto, { limit: '50' }))).length, 0);
});

test('history cursor must be a UUID', async () => {
  assert.ok((await validate(plainToInstance(RuleEngineHistoryQueryDto, { cursor: 'cursor' }))).length > 0);
  assert.equal((await validate(plainToInstance(RuleEngineHistoryQueryDto, { cursor: reviewId }))).length, 0);
});
