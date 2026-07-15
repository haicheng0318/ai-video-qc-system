import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import { getJwtConfig, validateEnvironment } from '../env';

const validSecret = 'a'.repeat(32);

test('JWT_SECRET is required at startup', () => {
  const environment = { ...process.env };
  delete environment.JWT_SECRET;

  assert.throws(() => validateEnvironment(environment), /JWT_SECRET is required/);
});

test('JWT_SECRET must be at least 32 characters', () => {
  assert.throws(
    () => validateEnvironment({ ...process.env, JWT_SECRET: 'too-short' }),
    /at least 32 characters/,
  );
});

test('JWT defaults to a maximum two-hour lifetime', () => {
  const config = getJwtConfig({ ...process.env, JWT_SECRET: validSecret, JWT_EXPIRES_IN: undefined });
  assert.equal(config.jwtExpiresIn, '2h');

  const token = new JwtService({
    secret: config.jwtSecret,
    signOptions: { expiresIn: config.jwtExpiresIn },
  }).sign({ sub: 'test-user' });
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as {
    iat: number;
    exp: number;
  };

  assert.ok(payload.exp - payload.iat <= 7200);
});

test('JWT_EXPIRES_IN values above two hours are rejected', () => {
  assert.throws(
    () => validateEnvironment({ ...process.env, JWT_SECRET: validSecret, JWT_EXPIRES_IN: '3h' }),
    /must not exceed 7200 seconds/,
  );
});
