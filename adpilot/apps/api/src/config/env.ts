import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

/**
 * All environment variables used by the backend processes (API, worker, scheduler).
 * Everything is validated at startup; the process refuses to start with an invalid configuration.
 * See `.env.example` for documentation of each variable.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url().default('http://localhost:3000'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(1),
  CORS_ORIGINS: z.string().default(''),

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(200).default(10),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379/0'),
  QUEUE_PREFIX: z.string().regex(/^[a-z0-9_-]+$/).default('adpilot'),

  ENCRYPTION_KEYS: z.string().min(1),
  ENCRYPTION_ACTIVE_KEY_ID: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  CSRF_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
  COOKIE_SECURE: bool.default(true),
  COOKIE_DOMAIN: z.string().optional(),

  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(1).default('adpilot-media'),
  S3_BACKUP_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default(true),

  META_GRAPH_API_VERSION: z.string().regex(/^v\d{2,3}\.\d$/).default('v26.0'),
  META_GRAPH_BASE_URL: z.url().default('https://graph.facebook.com'),
  META_GRAPH_VIDEO_BASE_URL: z.url().default('https://graph-video.facebook.com'),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5000).max(600000).default(60000),

  TMP_DIR: z.string().default('/tmp/adpilot'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  PG_DUMP_PATH: z.string().default('pg_dump'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: bool.default(false),

  WORKER_QUEUES: z.string().default('*'),
  WORKER_CONCURRENCY_SCALE: z.coerce.number().min(0.1).max(10).default(1),

  SUPER_ADMIN_EMAIL: z.string().optional(),
  SUPER_ADMIN_PASSWORD: z.string().optional(),
  SUPER_ADMIN_NAME: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;
let fileLoaded = false;

/**
 * Local development convenience: loads the nearest `.env` (cwd, then up to three parent directories)
 * unless the variables are already provided by the environment (Docker/systemd). ENV_FILE overrides.
 */
export function loadDotEnvFile(): void {
  if (fileLoaded) return;
  fileLoaded = true;
  const candidates = process.env.ENV_FILE
    ? [process.env.ENV_FILE]
    : [0, 1, 2, 3].map((up) => resolve(process.cwd(), ...Array<string>(up).fill('..'), '.env'));
  for (const file of candidates) {
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return;
    }
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached && source === process.env) return cached;
  if (source === process.env) loadDotEnvFile();
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

/** Test helper: forget the cached environment. */
export function resetEnvCache(): void {
  cached = null;
}
