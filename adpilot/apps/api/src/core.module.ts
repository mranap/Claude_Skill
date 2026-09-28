import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { RedisModule } from './infra/redis/redis.module';
import { CryptoModule } from './infra/crypto/crypto.module';
import { LocksModule } from './infra/locks/locks.module';
import { QueueModule } from './infra/queue/queue.module';
import { SettingsModule } from './modules/settings/settings.module';
import { AuditModule } from './modules/audit/audit.module';
import { MailModule } from './modules/mail/mail.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SystemLogModule } from './modules/system-log/system-log.module';
import { StorageModule } from './modules/storage/storage.module';
import { ActivityModule } from './modules/activity/activity.module';
import { MetaModule } from './modules/meta/meta.module';

/** Infrastructure shared by the API, worker and scheduler processes. */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    CryptoModule,
    LocksModule,
    QueueModule,
    SettingsModule,
    AuditModule,
    MailModule,
    TelegramModule,
    NotificationsModule,
    SystemLogModule,
    StorageModule,
    ActivityModule,
    MetaModule,
  ],
})
export class CoreModule {}
