import type { Type } from '@nestjs/common';
import { BackupTask, OutboxSweepTask, RetentionTask } from './tasks/platform.tasks';
import { AccountStatusTask, AssetSyncTask, TokenCheckTask } from './tasks/meta.tasks';
import { LaunchRecoveryTask, StatisticsSyncTask } from './tasks/statistics.tasks';
import { AutoRulesTask } from './tasks/rules.tasks';

export const SCHEDULER_FEATURE_MODULES: Type<unknown>[] = [];

export const SCHEDULER_TASK_PROVIDERS: Type<unknown>[] = [
  OutboxSweepTask,
  RetentionTask,
  BackupTask,
  TokenCheckTask,
  AssetSyncTask,
  AccountStatusTask,
  StatisticsSyncTask,
  LaunchRecoveryTask,
  AutoRulesTask,
];
