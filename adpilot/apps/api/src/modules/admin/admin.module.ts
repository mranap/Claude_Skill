import { Module } from '@nestjs/common';
import { AdminRolesController, AdminUsersController } from './admin-users.controller';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminLogsController } from './admin-logs.controller';
import { AdminBroadcastController } from './admin-broadcast.controller';
import { AdminUsersService } from './admin-users.service';
import { RolesService } from './roles.service';
import { BroadcastService } from './broadcast.service';

@Module({
  controllers: [AdminUsersController, AdminRolesController, AdminSettingsController, AdminLogsController, AdminBroadcastController],
  providers: [AdminUsersService, RolesService, BroadcastService],
  exports: [BroadcastService],
})
export class AdminModule {}
