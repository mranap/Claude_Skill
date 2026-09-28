import { Module } from '@nestjs/common';
import { CoreModule } from './core.module';
import { AuthModule } from './modules/auth/auth.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { WORKER_FEATURE_MODULES, WORKER_PROCESSORS } from './worker/worker-registry';
import { WorkerHostService } from './worker/worker-host.service';
import { QUEUE_PROCESSORS, QueueProcessor } from './worker/processor';

/** Background worker process: consumes the BullMQ queues. No HTTP server. */
@Module({
  imports: [CoreModule, AuthModule, MaintenanceModule, ...WORKER_FEATURE_MODULES],
  providers: [
    ...WORKER_PROCESSORS,
    {
      provide: QUEUE_PROCESSORS,
      useFactory: (...processors: QueueProcessor[]) => processors,
      inject: WORKER_PROCESSORS,
    },
    WorkerHostService,
  ],
})
export class WorkerModule {}
