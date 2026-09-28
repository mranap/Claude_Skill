import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { adAccountBulkConnectSchema, adAccountListQuerySchema, adAccountUpdateSchema, paginationQuerySchema } from '@adpilot/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { ActivityService } from '../activity/activity.service';
import { AdAccountsService } from './ad-accounts.service';
import type { AuthUser } from '../auth/auth.types';

const uuid = new ParseUUIDPipe();

@Controller('ad-accounts')
export class AdAccountsController {
  constructor(
    private readonly accounts: AdAccountsService,
    private readonly activity: ActivityService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(zod(adAccountListQuerySchema)) q: z.infer<typeof adAccountListQuerySchema>) {
    return this.accounts.list(user.id, q);
  }

  @Post('connect')
  @HttpCode(200)
  @RequirePermissions('app.meta_profiles.manage')
  bulkConnect(@CurrentUser() user: AuthUser, @Body(zod(adAccountBulkConnectSchema)) body: z.infer<typeof adAccountBulkConnectSchema>) {
    return this.accounts.bulkConnect(user.id, body.profileId, body.connect, body.disconnect);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.accounts.get(user.id, id);
  }

  @Patch(':id')
  @RequirePermissions('app.meta_profiles.manage')
  update(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body(zod(adAccountUpdateSchema)) body: z.infer<typeof adAccountUpdateSchema>) {
    return this.accounts.update(user.id, id, body);
  }

  @Post(':id/check-status')
  @HttpCode(202)
  checkStatus(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.accounts.checkNow(user.id, id);
  }

  @Get(':id/status-history')
  statusHistory(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.accounts.statusHistory(user.id, id);
  }

  @Get(':id/pixels')
  pixels(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.accounts.pixels(user.id, id);
  }

  @Get(':id/audiences')
  audiences(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.accounts.audiences(user.id, id);
  }

  @Get(':id/pages')
  pages(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.accounts.pages(user.id, id);
  }

  @Get(':id/activity')
  async timeline(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Query(zod(paginationQuerySchema)) q: z.infer<typeof paginationQuerySchema>) {
    await this.accounts.findOwned(user.id, id);
    return this.activity.list(user.id, { adAccountId: id, page: q.page, pageSize: q.pageSize });
  }
}
