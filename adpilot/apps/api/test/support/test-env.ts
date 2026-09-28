import { randomBytes } from 'node:crypto';
import { loadDotEnvFile } from '../../src/config/env';

/**
 * Test environment. Connection settings come from TEST_DATABASE_URL / TEST_REDIS_URL or are derived from the
 * development `.env` (database `<name>_test`, Redis database 15). Secrets are generated per run — nothing is
 * hard-coded. Guard rails refuse to run against a database whose name does not end with `_test`, because the
 * harness truncates every table.
 */
export function testDatabaseUrl(): string {
  loadDotEnvFile();
  const explicit = process.env.TEST_DATABASE_URL;
  const source = explicit ?? process.env.DATABASE_URL;
  if (!source) throw new Error('Set TEST_DATABASE_URL (or DATABASE_URL in .env) to run the integration tests');
  const url = new URL(source);
  if (!explicit) url.pathname = `${url.pathname.replace(/\/+$/, '').replace(/_test$/, '')}_test`;
  const db = url.pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/.test(db)) throw new Error(`Refusing to use database "${db}" for tests: the name must end with "_test"`);
  return url.toString();
}

export function testRedisUrl(): string {
  loadDotEnvFile();
  if (process.env.TEST_REDIS_URL) return process.env.TEST_REDIS_URL;
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379/0');
  url.pathname = '/15';
  return url.toString();
}

const secret = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Applies the test configuration to process.env (called before any application module reads it). */
export function applyTestEnv(): void {
  const databaseUrl = testDatabaseUrl();
  const redisUrl = testRedisUrl();
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3000',
    CORS_ORIGINS: '',
    DATABASE_URL: databaseUrl,
    DATABASE_POOL_SIZE: '5',
    REDIS_URL: redisUrl,
    // Unique per test process: a leftover process from an aborted run can never consume this run's jobs.
    QUEUE_PREFIX: `adpilot-test-${process.pid}`,
    ENCRYPTION_KEYS: `t1:${randomBytes(32).toString('base64')}`,
    ENCRYPTION_ACTIVE_KEY_ID: 't1',
    JWT_ACCESS_SECRET: secret(48),
    CSRF_SECRET: secret(48),
    COOKIE_SECURE: 'false',
    S3_BUCKET: 'adpilot-media-test',
    S3_BACKUP_BUCKET: 'adpilot-backups-test',
    S3_ACCESS_KEY_ID: 'test-access-key',
    S3_SECRET_ACCESS_KEY: secret(24),
    S3_FORCE_PATH_STYLE: 'true',
    TMP_DIR: `/tmp/adpilot-test-${process.pid}`,
    // Tests act as if behind one reverse proxy, so a client can present its own source IP (X-Forwarded-For).
    TRUST_PROXY: '1',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'error',
    WORKER_QUEUES: '*',
    SUPER_ADMIN_EMAIL: 'root@adpilot.test',
    SUPER_ADMIN_PASSWORD: `Sa1${secret(18)}`,
    SUPER_ADMIN_NAME: 'Root Admin',
  });
  delete process.env.COOKIE_DOMAIN;
  delete process.env.META_APP_ID;
  delete process.env.META_APP_SECRET;
}
