import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { AppConfig } from '../../config/app-config';

/** Single Prisma client per process (connection pool via the `pg` driver adapter). */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: AppConfig) {
    const adapter = new PrismaPg({
      connectionString: config.env.DATABASE_URL,
      max: config.env.DATABASE_POOL_SIZE,
    });
    super({ adapter });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
