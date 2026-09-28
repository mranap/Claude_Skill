import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 does not load .env files automatically; mirror the application's lookup for local development.
for (const file of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (!process.env.DATABASE_URL && existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}

// Prisma CLI configuration (migrations, generate). The runtime client receives its
// connection string from the application config (see src/infra/prisma/prisma.service.ts).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
