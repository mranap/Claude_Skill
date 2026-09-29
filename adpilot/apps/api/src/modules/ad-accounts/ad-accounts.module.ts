import { Module } from '@nestjs/common';
import { AdAccountsController } from './ad-accounts.controller';
import { AdAccountsService } from './ad-accounts.service';
import { TargetingLookupService } from './targeting-lookup.service';

@Module({
  controllers: [AdAccountsController],
  providers: [AdAccountsService, TargetingLookupService],
  exports: [AdAccountsService],
})
export class AdAccountsModule {}
