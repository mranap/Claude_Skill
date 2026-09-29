import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { dateRangeQuerySchema } from '@adpilot/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { DashboardService } from './dashboard.service';
import type { AuthUser } from '../auth/auth.types';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @RequirePermissions('app.statistics.view')
  get(
    @CurrentUser() user: AuthUser,
    @Query(zod(dateRangeQuerySchema)) q: z.infer<typeof dateRangeQuerySchema>,
  ) {
    return this.dashboard.get(user.id, q.range, { from: q.from, to: q.to });
  }
}
