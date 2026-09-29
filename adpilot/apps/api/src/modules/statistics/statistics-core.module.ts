import { Global, Module } from '@nestjs/common';
import { StatsQueryService } from './stats-query.service';

/** Statistics services shared by the API (dashboard, tables) and the workers (auto rules). */
@Global()
@Module({
  providers: [StatsQueryService],
  exports: [StatsQueryService],
})
export class StatisticsCoreModule {}
