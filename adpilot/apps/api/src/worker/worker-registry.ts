import type { Type } from '@nestjs/common';
import { AdminModule } from '../modules/admin/admin.module';
import { CreativesModule } from '../modules/creatives/creatives.module';
import { EmailProcessor } from './processors/email.processor';
import { TelegramProcessor } from './processors/telegram.processor';
import { MaintenanceProcessor } from './processors/maintenance.processor';
import { MetaSyncProcessor } from './processors/meta-sync.processor';
import { AccountStatusProcessor } from './processors/account-status.processor';
import { CreativeUploadProcessor } from './processors/creative-upload.processor';

/** Domain modules whose services the processors need. */
export const WORKER_FEATURE_MODULES: Type<unknown>[] = [AdminModule, CreativesModule];

/** One processor per queue. */
export const WORKER_PROCESSORS: Type<unknown>[] = [
  EmailProcessor,
  TelegramProcessor,
  MaintenanceProcessor,
  MetaSyncProcessor,
  AccountStatusProcessor,
  CreativeUploadProcessor,
];
