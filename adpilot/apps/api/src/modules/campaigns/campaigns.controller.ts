import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { DATE_RANGE_KEYS } from '@adpilot/shared';
import { CurrentUser, RateLimit, RequirePermissions } from '../../common/decorators/auth.decorators';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { CampaignsService, budgetChangeSchema, campaignListQuerySchema } from './campaigns.service';
import { BulkActionsService, bulkStatusSchema } from './bulk-actions.service';
import { EntityActionsService } from './entity-actions.service';
import type { AuthUser } from '../auth/auth.types';

const uuid = new ParseUUIDPipe();
const detailQuery = z.object({
  range: z.enum(DATE_RANGE_KEYS).default('last_7d'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const statusSchema = z.object({ level: z.enum(['CAMPAIGN', 'ADSET', 'AD']), id: z.uuid(), status: z.enum(['ACTIVE', 'PAUSED']) });

@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly bulk: BulkActionsService,
    private readonly actions: EntityActionsService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(zod(campaignListQuerySchema)) q: z.infer<typeof campaignListQuerySchema>) {
    return this.campaigns.list(user.id, q);
  }

  @Get('bulk/:id')
  bulkStatusResult(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.bulk.get(user.id, id);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Query(zod(detailQuery)) q: z.infer<typeof detailQuery>) {
    return this.campaigns.detail(user.id, id, q.range, { from: q.from, to: q.to });
  }

  /** Pause / start one campaign, ad set or ad (confirmed in the UI). */
  @Post('actions/status')
  @HttpCode(200)
  @RequirePermissions('app.campaigns.manage')
  @RateLimit({ bucket: 'entity-status', limit: 120, windowSeconds: 60 })
  async setStatus(@CurrentUser() user: AuthUser, @Body(zod(statusSchema)) body: z.infer<typeof statusSchema>) {
    const e = await this.actions.resolve(user.id, body.level, body.id);
    return this.actions.setStatus(e, body.status, { source: 'USER', actorUserId: user.id });
  }

  @Post('actions/budget')
  @HttpCode(200)
  @RequirePermissions('app.campaigns.manage')
  @RateLimit({ bucket: 'entity-budget', limit: 60, windowSeconds: 60 })
  changeBudget(@CurrentUser() user: AuthUser, @Body(zod(budgetChangeSchema)) body: z.infer<typeof budgetChangeSchema>) {
    return this.campaigns.changeBudget(user.id, body);
  }

  /** Bulk pause/start with idempotency key and explicit confirmation. */
  @Post('actions/bulk-status')
  @HttpCode(202)
  @RequirePermissions('app.campaigns.manage')
  @RateLimit({ bucket: 'bulk-status', limit: 30, windowSeconds: 600 })
  bulkStatus(@CurrentUser() user: AuthUser, @Body(zod(bulkStatusSchema)) body: z.infer<typeof bulkStatusSchema>) {
    return this.bulk.requestStatus(user.id, body);
  }
}
