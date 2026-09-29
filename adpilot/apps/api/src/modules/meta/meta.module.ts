import { Global, Module } from '@nestjs/common';
import { MetaGraphClient } from './graph/meta-graph.client';
import { MetaRateLimitService } from './graph/rate-limit.service';
import { MetaApiLogService } from './graph/meta-api-log.service';
import { MetaConnectionFactory } from './meta-connection.factory';
import { TokenInspectorService } from './token-inspector.service';
import { MetaProfileStatusService } from './meta-profile-status.service';
import { MetaAssetsService } from './meta-assets.service';
import { MetaConnectivityService } from './meta-connectivity.service';
import { AccountStatusService } from '../ad-accounts/account-status.service';

/** Meta Marketing API integration layer (shared by API, workers and scheduler). */
@Global()
@Module({
  providers: [
    MetaGraphClient,
    MetaRateLimitService,
    MetaApiLogService,
    MetaConnectionFactory,
    TokenInspectorService,
    MetaProfileStatusService,
    MetaAssetsService,
    MetaConnectivityService,
    AccountStatusService,
  ],
  exports: [
    MetaGraphClient,
    MetaRateLimitService,
    MetaApiLogService,
    MetaConnectionFactory,
    TokenInspectorService,
    MetaProfileStatusService,
    MetaAssetsService,
    MetaConnectivityService,
    AccountStatusService,
  ],
})
export class MetaModule {}
