import { Global, Module } from '@nestjs/common';
import { DraftsController, LaunchesController } from './launches.controller';
import { LaunchesService } from './launches.service';
import { DraftsService } from './drafts.service';
import { LaunchValidatorService } from './launch-validator.service';
import { PlanBuilderService } from './plan-builder.service';
import { LaunchExecutorService } from './launch-executor.service';
import { TemplatesController } from '../templates/templates.controller';
import { TemplatesService } from '../templates/templates.service';
import { EntitySyncService } from '../campaigns/entity-sync.service';

@Global()
@Module({
  controllers: [TemplatesController, LaunchesController, DraftsController],
  providers: [TemplatesService, LaunchesService, DraftsService, LaunchValidatorService, PlanBuilderService, LaunchExecutorService, EntitySyncService],
  exports: [LaunchExecutorService, EntitySyncService, TemplatesService],
})
export class LaunchesModule {}
