import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TriggerResultReviewDto } from '../modules/result-reviews/dto/trigger-result-review.dto';
import { ResultReviewHistoryQueryDto } from '../modules/result-reviews/dto/result-review-history-query.dto';

test('resultMetricId is required and must be a UUID', async () => {
  assert.ok((await validate(plainToInstance(TriggerResultReviewDto, {}))).length > 0);
  assert.ok((await validate(plainToInstance(TriggerResultReviewDto, { resultMetricId: 'metric' }))).length > 0);
  assert.equal((await validate(plainToInstance(TriggerResultReviewDto, {
    resultMetricId: '00000000-0000-4000-8000-000000000051',
  }))).length, 0);
});

for (const field of ['modelName', 'dataGrade', 'videoId', 'status']) {
  test(`global whitelist rejects result review mass assignment field ${field}`, async () => {
    const instance = plainToInstance(TriggerResultReviewDto, {
      resultMetricId: '00000000-0000-4000-8000-000000000051',
      [field]: 'unsafe',
    });
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    assert.ok(errors.some((error) => error.property === field));
  });
}

test('result review history limit defaults to 20 and caps at 50', async () => {
  const defaults = plainToInstance(ResultReviewHistoryQueryDto, {});
  assert.equal(defaults.limit, 20);
  assert.equal((await validate(defaults)).length, 0);
  assert.ok((await validate(plainToInstance(ResultReviewHistoryQueryDto, { limit: '51' }))).length > 0);
});
