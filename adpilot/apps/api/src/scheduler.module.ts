import { Module } from '@nestjs/common';
import { CoreModule } from './core.module';
import { SchedulerService } from './scheduler/scheduler.service';
import { TelegramPollerService } from './scheduler/telegram-poller.service';
import { SCHEDULER_TASKS, SchedulerTask } from './scheduler/scheduler-task';
import { SCHEDULER_FEATURE_MODULES, SCHEDULER_TASK_PROVIDERS } from './scheduler/scheduler-registry';

/** Scheduler process: leader-elected periodic tasks + Telegram long polling. */
@Module({
  imports: [CoreModule, ...SCHEDULER_FEATURE_MODULES],
  providers: [
    ...SCHEDULER_TASK_PROVIDERS,
    {
      provide: SCHEDULER_TASKS,
      useFactory: (...tasks: SchedulerTask[]) => tasks,
      inject: SCHEDULER_TASK_PROVIDERS,
    },
    SchedulerService,
    TelegramPollerService,
  ],
})
export class SchedulerModule {}
