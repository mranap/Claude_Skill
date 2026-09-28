import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import IORedis from 'ioredis';
import pg from 'pg';
import { testDatabaseUrl, testRedisUrl } from './test-env';

/**
 * Runs once per `vitest run` (integration/e2e projects): creates the `<name>_test` database when needed
 * and applies all Prisma migrations to it — the same `migrate deploy` used in production.
 */
export default async function globalSetup(): Promise<void> {
  const url = testDatabaseUrl();
  const dbName = new URL(url).pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    // dbName is validated by testDatabaseUrl() (^[a-z0-9_]+_test$), so quoting it is safe.
    if (!exists.rowCount) await client.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }
  // Remove queues/caches left behind by earlier (aborted) runs.
  const redis = new IORedis(testRedisUrl());
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'adpilot-test*', 'COUNT', 1000);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
  } finally {
    redis.disconnect();
  }
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: resolve(process.cwd()),
    env: { ...process.env, DATABASE_URL: url },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}
