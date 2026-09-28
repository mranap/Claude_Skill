import { Global, Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { BulkActionsService } from './bulk-actions.service';
import { EntityActionsService } from './entity-actions.service';
import { StatisticsController } from '../statistics/statistics.controller';
import { StatisticsService } from '../statistics/statistics.service';
import { InsightsSyncService } from '../statistics/insights-sync.service';

@Global()
@Module({
  controllers: [CampaignsController, StatisticsController],
  providers: [
    CampaignsService,
    BulkActionsService,
    EntityActionsService,
    StatisticsService,
    InsightsSyncService,
  ],
  exports: [EntityActionsService, BulkActionsService, InsightsSyncService],
})
export class CampaignsModule {}
