import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { broadcastSchema, paginationQuerySchema } from '@adpilot/shared';
import { CurrentUser, RateLimit, RequirePermissions } from '../../common/decorators/auth.decorators';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { BroadcastService } from './broadcast.service';
import type { AuthUser } from '../auth/auth.types';

@Controller('admin/broadcasts')
export class AdminBroadcastController {
  constructor(private readonly broadcasts: BroadcastService) {}

  @Get()
  @RequirePermissions('admin.broadcast.send')
  list(@Query(zod(paginationQuerySchema)) q: z.infer<typeof paginationQuerySchema>) {
    return this.broadcasts.list(q.page, q.pageSize);
  }

  @Post()
  @RequirePermissions('admin.broadcast.send')
  @RateLimit({ bucket: 'broadcast', limit: 10, windowSeconds: 3600 })
  create(@CurrentUser() user: AuthUser, @Body(zod(broadcastSchema)) body: z.infer<typeof broadcastSchema>) {
    return this.broadcasts.create(user, body);
  }
}
