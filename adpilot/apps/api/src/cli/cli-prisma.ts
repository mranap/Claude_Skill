import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { loadEnv } from '../config/env';

export function createCliPrisma(): PrismaClient {
  const env = loadEnv();
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL, max: 2 }) });
}
