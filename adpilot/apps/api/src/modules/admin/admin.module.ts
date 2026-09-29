import { Module } from '@nestjs/common';
import { AdminRolesController, AdminUsersController } from './admin-users.controller';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminLogsController } from './admin-logs.controller';
import { AdminBroadcastController } from './admin-broadcast.controller';
import { AdminOpsController } from './admin-ops.controller';
import { AdminUsersService } from './admin-users.service';
import { RolesService } from './roles.service';
import { BroadcastService } from './broadcast.service';
import { SystemHealthService } from './system-health.service';
import { MaintenanceModule } from '../maintenance/maintenance.module';

@Module({
  imports: [MaintenanceModule],
  controllers: [
    AdminUsersController,
    AdminRolesController,
    AdminSettingsController,
    AdminLogsController,
    AdminBroadcastController,
    AdminOpsController,
  ],
  providers: [AdminUsersService, RolesService, BroadcastService, SystemHealthService],
  exports: [BroadcastService, SystemHealthService],
})
export class AdminModule {}
