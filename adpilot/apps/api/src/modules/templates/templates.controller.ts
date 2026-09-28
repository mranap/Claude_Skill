import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { templateCreateSchema, templateListQuerySchema, templateUpdateSchema } from '@adpilot/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { TemplatesService } from './templates.service';
import type { AuthUser } from '../auth/auth.types';

const uuid = new ParseUUIDPipe();

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(zod(templateListQuerySchema)) q: z.infer<typeof templateListQuerySchema>) {
    return this.templates.list(user.id, q);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.templates.get(user.id, id);
  }

  @Post()
  @RequirePermissions('app.templates.manage')
  create(@CurrentUser() user: AuthUser, @Body(zod(templateCreateSchema)) body: z.infer<typeof templateCreateSchema>) {
    return this.templates.create(user.id, body);
  }

  @Patch(':id')
  @RequirePermissions('app.templates.manage')
  update(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body(zod(templateUpdateSchema)) body: z.infer<typeof templateUpdateSchema>) {
    return this.templates.update(user.id, id, body);
  }

  @Post(':id/clone')
  @HttpCode(201)
  @RequirePermissions('app.templates.manage')
  clone(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.templates.clone(user.id, id);
  }

  @Delete(':id')
  @RequirePermissions('app.templates.manage')
  remove(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.templates.remove(user.id, id);
  }
}
