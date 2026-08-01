import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateResultMetricSnapshotDto } from '../modules/result-metrics/dto/create-result-metric-snapshot.dto';
import { ResultMetricHistoryQueryDto } from '../modules/result-metrics/dto/result-metric-history-query.dto';

test('result metric DTO accepts zero counts and percentages', async () => {
  const dto = plainToInstance(CreateResultMetricSnapshotDto, {
    views: 0,
    ctr: 0,
  });
  assert.equal((await validate(dto)).length, 0);
});

for (const [name, value] of [
  ['negative count', { views: -1 }],
  ['decimal count', { views: 1.5 }],
  ['infinite decimal', { roi: Number.POSITIVE_INFINITY }],
  ['too many money decimals', { spend: 1.001 }],
] as const) {
  test(`result metric DTO rejects ${name}`, async () => {
    const errors = await validate(plainToInstance(CreateResultMetricSnapshotDto, value));
    assert.ok(errors.length > 0);
  });
}

test('result metric DTO rejects non-http URL schemes', async () => {
  const errors = await validate(plainToInstance(CreateResultMetricSnapshotDto, {
    publishUrl: 'javascript:alert(1)',
  }));
  assert.ok(errors.some((error) => error.property === 'publishUrl'));
});

for (const serverField of ['id', 'videoId', 'videoType', 'submittedBy', 'createdAt', 'updatedAt']) {
  test(`global validation rejects server-managed field ${serverField}`, async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    await assert.rejects(
      pipe.transform(
        { [serverField]: 'client-value', views: 1 },
        { type: 'body', metatype: CreateResultMetricSnapshotDto },
      ),
      BadRequestException,
    );
  });
}

test('history query defaults to 20 and rejects limits above 50', async () => {
  const normal = plainToInstance(ResultMetricHistoryQueryDto, {});
  assert.equal(normal.limit, 20);
  const invalid = plainToInstance(ResultMetricHistoryQueryDto, { limit: 51 });
  assert.ok((await validate(invalid)).some((error) => error.property === 'limit'));
});
