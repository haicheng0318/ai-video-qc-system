// Test/acceptance entrypoints only. Application code must not import this helper.
export function assertIsolatedDatabase(value: string | undefined) {
  if (!value) throw Error('An explicit isolated acceptance database is required.');
  const url = new URL(value);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1'
    || !['55439', '55441'].includes(url.port)
    || !/^\/(?:release_test|identity_test|queue_test|identity_queue_test|ops_test)$/.test(url.pathname)
    || url.hash || [...url.searchParams].some(([key, setting]) => key !== 'schema' || setting !== 'public')) {
    throw Error('Acceptance refuses production, non-loopback and non-test database targets.');
  }
  return value;
}

export function configureLocalAcceptance(value: string | undefined, environment: NodeJS.ProcessEnv = process.env) {
  if (environment.QC_LOCAL_ACCEPTANCE !== '1' || environment.NODE_ENV === 'production') throw Error('Set QC_LOCAL_ACCEPTANCE=1 for isolated local acceptance; production is refused.');
  environment.DATABASE_URL = assertIsolatedDatabase(value);
  environment.QC_SKIP_DOTENV = '1';
  environment.VIDEO_STORAGE_PROVIDER = 'local';
  environment.JWT_SECRET = 'local-acceptance-fixture-only-secret-at-least-32';
  environment.WEB_ORIGIN = 'http://localhost:3000';
  for (const key of ['DASHSCOPE_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET',
    'OSS_BUCKET', 'COS_BUCKET', 'TENCENTCLOUD_SECRET_ID', 'TENCENTCLOUD_SECRET_KEY', 'TENCENTCLOUD_SESSION_TOKEN']) environment[key] = '';
  return environment.DATABASE_URL;
}
