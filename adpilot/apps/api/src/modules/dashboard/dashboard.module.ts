import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { SearchController } from '../search/search.controller';

@Module({
  controllers: [DashboardController, SearchController],
  providers: [DashboardService],
})
export class DashboardModule {}
