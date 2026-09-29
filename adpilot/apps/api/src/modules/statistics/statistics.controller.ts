import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { statsQuerySchema } from '@adpilot/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { StatisticsService } from './statistics.service';
import type { AuthUser } from '../auth/auth.types';

const refreshSchema = z.object({ adAccountId: z.uuid().optional() });

@Controller('statistics')
@RequirePermissions('app.statistics.view')
export class StatisticsController {
  constructor(private readonly statistics: StatisticsService) {}

  @Get()
  table(@CurrentUser() user: AuthUser, @Query(zod(statsQuerySchema)) q: z.infer<typeof statsQuerySchema>) {
    return this.statistics.table(user.id, q);
  }

  @Post('refresh')
  @HttpCode(202)
  refresh(@CurrentUser() user: AuthUser, @Body(zod(refreshSchema)) body: z.infer<typeof refreshSchema>) {
    return this.statistics.refresh(user.id, body.adAccountId);
  }
}
