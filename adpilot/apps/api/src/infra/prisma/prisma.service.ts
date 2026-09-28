import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { AppConfig } from '../../config/app-config';

/** Single Prisma client per process (connection pool via the `pg` driver adapter). */
@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown {
  constructor(config: AppConfig) {
    const adapter = new PrismaPg({
      connectionString: config.env.DATABASE_URL,
      max: config.env.DATABASE_POOL_SIZE,
    });
    super({ adapter });
  }

  /** Shutdown phase 3 (last). */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
