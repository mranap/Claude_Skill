import type { Type } from '@nestjs/common';
import { AdminModule } from './modules/admin/admin.module';
import { MetaProfilesModule } from './modules/meta-profiles/meta-profiles.module';
import { AdAccountsModule } from './modules/ad-accounts/ad-accounts.module';
import { CreativesModule } from './modules/creatives/creatives.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { LaunchesModule } from './modules/launches/launches.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { RulesModule } from './modules/rules/rules.module';

/** Product feature modules mounted by the HTTP API. */
export const FEATURE_MODULES: Type<unknown>[] = [AdminModule, MetaProfilesModule, AdAccountsModule, CreativesModule, DashboardModule, LaunchesModule, CampaignsModule, RulesModule];
