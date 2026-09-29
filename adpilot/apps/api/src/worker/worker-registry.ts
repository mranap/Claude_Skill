import type { Type } from '@nestjs/common';
import { AdminModule } from '../modules/admin/admin.module';
import { CreativesModule } from '../modules/creatives/creatives.module';
import { LaunchesModule } from '../modules/launches/launches.module';
import { CampaignsModule } from '../modules/campaigns/campaigns.module';
import { RulesModule } from '../modules/rules/rules.module';
import { EmailProcessor } from './processors/email.processor';
import { TelegramProcessor } from './processors/telegram.processor';
import { MaintenanceProcessor } from './processors/maintenance.processor';
import { MetaSyncProcessor } from './processors/meta-sync.processor';
import { AccountStatusProcessor } from './processors/account-status.processor';
import { CreativeUploadProcessor } from './processors/creative-upload.processor';
import { CampaignLaunchProcessor } from './processors/campaign-launch.processor';
import { StatisticsProcessor } from './processors/statistics.processor';
import { BulkActionsProcessor } from './processors/bulk-actions.processor';
import { AutoRulesProcessor } from './processors/auto-rules.processor';

/** Domain modules whose services the processors need. */
export const WORKER_FEATURE_MODULES: Type<unknown>[] = [
  AdminModule,
  CreativesModule,
  LaunchesModule,
  CampaignsModule,
  RulesModule,
];

/** One processor per queue. */
export const WORKER_PROCESSORS: Type<unknown>[] = [
  EmailProcessor,
  TelegramProcessor,
  MaintenanceProcessor,
  MetaSyncProcessor,
  AccountStatusProcessor,
  CreativeUploadProcessor,
  CampaignLaunchProcessor,
  StatisticsProcessor,
  BulkActionsProcessor,
  AutoRulesProcessor,
];
