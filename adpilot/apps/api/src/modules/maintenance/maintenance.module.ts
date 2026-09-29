import { Global, Module } from '@nestjs/common';
import { RetentionService } from './retention.service';
import { BackupService } from './backup.service';

@Global()
@Module({
  providers: [RetentionService, BackupService],
  exports: [RetentionService, BackupService],
})
export class MaintenanceModule {}
