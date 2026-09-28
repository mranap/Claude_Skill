import { Module } from '@nestjs/common';
import { MetaProfilesController } from './meta-profiles.controller';
import { MetaProfilesService } from './meta-profiles.service';

@Module({
  controllers: [MetaProfilesController],
  providers: [MetaProfilesService],
  exports: [MetaProfilesService],
})
export class MetaProfilesModule {}
