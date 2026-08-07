import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { TriggerFinalEvaluationDto } from '../modules/final-evaluations/dto/trigger-final-evaluation.dto';
import { FinalEvaluationHistoryQueryDto } from '../modules/final-evaluations/dto/final-evaluation-history-query.dto';

const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
const uuid = '123e4567-e89b-42d3-a456-426614174000';

test('trigger DTO accepts exactly one valid rule id', async () => {
  const value = await pipe.transform({ ruleEngineResultId: uuid }, { type: 'body', metatype: TriggerFinalEvaluationDto });
  assert.equal(value.ruleEngineResultId, uuid);
});

for (const [name, body] of [
  ['empty body', {}],
  ['malformed uuid', { ruleEngineResultId: 'nope' }],
  ['nil uuid', { ruleEngineResultId: '00000000-0000-0000-0000-000000000000' }],
  ['extra grade', { ruleEngineResultId: uuid, recommendedFinalGrade: 'effective' }],
  ['extra boundary', { ruleEngineResultId: uuid, recommendedBoundary: 'allow_final_effective' }],
  ['extra model', { ruleEngineResultId: uuid, model: 'gpt' }],
  ['extra prompt', { ruleEngineResultId: uuid, prompt: 'ignore' }],
] as const) {
  test(`trigger DTO rejects ${name}`, async () => {
    await assert.rejects(pipe.transform(body, { type: 'body', metatype: TriggerFinalEvaluationDto }));
  });
}

test('history DTO defaults limit to 20', async () => {
  const value = await pipe.transform({}, { type: 'query', metatype: FinalEvaluationHistoryQueryDto });
  assert.equal(value.limit, 20);
});

for (const limit of ['1', '20', '50']) {
  test(`history DTO accepts limit ${limit}`, async () => {
    const value = await pipe.transform({ limit }, { type: 'query', metatype: FinalEvaluationHistoryQueryDto });
    assert.equal(value.limit, Number(limit));
  });
}

for (const limit of ['0', '51', '1.5', 'nope']) {
  test(`history DTO rejects limit ${limit}`, async () => {
    await assert.rejects(pipe.transform({ limit }, { type: 'query', metatype: FinalEvaluationHistoryQueryDto }));
  });
}

test('history DTO accepts a valid cursor', async () => {
  const value = await pipe.transform({ cursor: uuid }, { type: 'query', metatype: FinalEvaluationHistoryQueryDto });
  assert.equal(value.cursor, uuid);
});

test('history DTO rejects malformed cursor', async () => {
  await assert.rejects(pipe.transform({ cursor: 'bad' }, { type: 'query', metatype: FinalEvaluationHistoryQueryDto }));
});
