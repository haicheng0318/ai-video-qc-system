import * as dotenv from 'dotenv';
import { join } from 'node:path';

// Explicit isolated-test/managed-runtime mode: do not read developer secret files.
if (process.env.QC_SKIP_DOTENV !== '1') {
  dotenv.config({ path: join(process.cwd(), '../../.env') });
  dotenv.config();
}

export type RuntimeConfig = {
  jwtSecret: string;
  jwtExpiresIn: string;
};

export function parseJwtExpiresIn(value: string) {
	const match = /^(\d+)\s*(s|m|h)$/i.exec(value);
	if (!match) {
		throw new Error(
			'JWT_EXPIRES_IN must include a unit suffix: use s, m, or h (for example 7200s, 120m, or 2h).',
		);
	}

	const amount = Number(match[1]);
	const unit = match[2].toLowerCase();
  const multiplier = unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
  return amount * multiplier;
}

export function validateEnvironment(environment: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const jwtSecret = environment.JWT_SECRET?.trim();
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is required and must not be empty.');
  }

  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long.');
  }

  const jwtExpiresIn = environment.JWT_EXPIRES_IN?.trim() || '2h';
  if (parseJwtExpiresIn(jwtExpiresIn) > 7200) {
    throw new Error('JWT_EXPIRES_IN must not exceed 7200 seconds.');
  }

  if (environment.VIDEO_STORAGE_PROVIDER?.trim().toLowerCase() === 'cos') {
    for (const name of [
      'COS_REGION',
      'COS_BUCKET',
      'TENCENTCLOUD_SECRET_ID',
      'TENCENTCLOUD_SECRET_KEY',
    ]) {
      if (!environment[name]?.trim()) {
        throw new Error(`${name} is required when VIDEO_STORAGE_PROVIDER=cos.`);
      }
    }
  }

  if (environment.NODE_ENV === 'production') {
    const webOrigin = environment.WEB_ORIGIN?.trim();
    if (!webOrigin || !/^https:\/\/[^/]+$/i.test(webOrigin)) {
      throw new Error('WEB_ORIGIN must be a single HTTPS origin in production.');
    }
  }

  return { jwtSecret, jwtExpiresIn };
}

export function getJwtConfig(environment: NodeJS.ProcessEnv = process.env) {
  return validateEnvironment(environment);
}
