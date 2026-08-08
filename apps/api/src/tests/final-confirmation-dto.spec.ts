import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { CreateFinalConfirmationDto } from '../modules/final-confirmations/dto/create-final-confirmation.dto';
import { MarkCaseDto } from '../modules/cases/dto/mark-case.dto';
import { CaseListQueryDto } from '../modules/cases/dto/case-list-query.dto';
import { DashboardBreakdownQueryDto, DashboardTrendQueryDto } from '../modules/dashboard/dto/dashboard-query.dto';

const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
const uuid = '123e4567-e89b-42d3-a456-426614174000';

for (const finalGrade of ['effective', 'low_effective', 'invalid']) {
  test(`confirmation DTO accepts ${finalGrade}`, async () => {
    const value = await pipe.transform({ evaluationId: uuid, finalGrade, canBeUsedForPerformance: false }, { type: 'body', metatype: CreateFinalConfirmationDto });
    assert.equal(value.finalGrade, finalGrade);
  });
}

for (const [name, body] of [
  ['missing evaluation', { finalGrade: 'effective', canBeUsedForPerformance: false }],
  ['bad evaluation', { evaluationId: 'x', finalGrade: 'effective', canBeUsedForPerformance: false }],
  ['unknown grade', { evaluationId: uuid, finalGrade: 'S', canBeUsedForPerformance: false }],
  ['string performance', { evaluationId: uuid, finalGrade: 'effective', canBeUsedForPerformance: 'false' }],
  ['mass assigned status', { evaluationId: uuid, finalGrade: 'effective', canBeUsedForPerformance: false, finalStatus: 'final_effective' }],
  ['mass assigned confirmer', { evaluationId: uuid, finalGrade: 'effective', canBeUsedForPerformance: false, confirmedBy: uuid }],
]) {
  test(`confirmation DTO rejects ${name}`, async () => {
    await assert.rejects(pipe.transform(body, { type: 'body', metatype: CreateFinalConfirmationDto }));
  });
}

test('confirmation DTO trims optional text', async () => {
  const value = await pipe.transform({ evaluationId: uuid, finalGrade: 'effective', canBeUsedForPerformance: false, confirmationComment: '  确认  ' }, { type: 'body', metatype: CreateFinalConfirmationDto });
  assert.equal(value.confirmationComment, '确认');
});

for (const caseType of ['excellent', 'negative', 'none']) {
  test(`case DTO accepts ${caseType}`, async () => {
    const value = await pipe.transform({ evaluationId: uuid, caseType, reason: '  具体标记原因  ' }, { type: 'body', metatype: MarkCaseDto });
    assert.equal(value.reason, '具体标记原因');
  });
}

for (const reason of ['', '四字']) {
  test(`case DTO rejects short reason ${JSON.stringify(reason)}`, async () => {
    await assert.rejects(pipe.transform({ evaluationId: uuid, caseType: 'none', reason }, { type: 'body', metatype: MarkCaseDto }));
  });
}

for (const type of ['excellent', 'negative']) {
  test(`case list accepts ${type}`, async () => {
    const value = await pipe.transform({ type }, { type: 'query', metatype: CaseListQueryDto });
    assert.equal(value.limit, 20);
  });
}

for (const granularity of ['day', 'week']) {
  test(`dashboard trend accepts ${granularity}`, async () => {
    const value = await pipe.transform({ granularity }, { type: 'query', metatype: DashboardTrendQueryDto });
    assert.equal(value.granularity, granularity);
  });
}

for (const groupBy of ['brand', 'platform', 'videoType', 'creator']) {
  test(`dashboard breakdown accepts ${groupBy}`, async () => {
    const value = await pipe.transform({ groupBy }, { type: 'query', metatype: DashboardBreakdownQueryDto });
    assert.equal(value.groupBy, groupBy);
  });
}
