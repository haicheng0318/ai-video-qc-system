import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UserRole } from '@prisma/client';
import { Request, Response } from 'express';
import { ResultMetricsController } from '../modules/result-metrics/result-metrics.controller';
import { ResultMetricsService } from '../modules/result-metrics/result-metrics.service';

test('latest explicitly serializes an empty result as JSON null', async () => {
  let statusCode = 0;
  let responseBody: unknown = 'unset';
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      responseBody = body;
      return this;
    },
  } as unknown as Response;
  const service = {
    latest: async () => null,
  } as unknown as ResultMetricsService;
  const controller = new ResultMetricsController(service);

  await controller.latest(
    '00000000-0000-4000-8000-000000000040',
    {
      id: '00000000-0000-4000-8000-000000000041',
      account: 'admin',
      name: 'Admin',
      role: UserRole.admin,
      managerId: null,
    },
    { headers: {} } as Request,
    response,
  );

  assert.equal(statusCode, 200);
  assert.equal(responseBody, null);
});
