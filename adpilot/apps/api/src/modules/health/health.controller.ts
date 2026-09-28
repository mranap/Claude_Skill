import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { Public } from '../../common/decorators/auth.decorators';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { SettingsService } from '../settings/settings.service';

/** Liveness/readiness endpoints used by Docker health checks and the reverse proxy. */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready() {
    const [db, redis] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.client.ping(),
    ]);
    const result = { database: db.status === 'fulfilled', redis: redis.status === 'fulfilled' };
    if (!result.database || !result.redis) {
      throw new HttpException({ status: 'unavailable', ...result }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { status: 'ok', ...result };
  }
}

/** Public platform status: maintenance banner and platform name (no secrets, no user data). */
@Controller('system')
export class SystemStatusController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @Get('status')
  async status() {
    const [maintenance, general] = await Promise.all([this.settings.get('maintenance'), this.settings.get('general')]);
    return { maintenance: { enabled: maintenance.enabled, message: maintenance.enabled ? maintenance.message : null }, platformName: general.platformName };
  }
}
