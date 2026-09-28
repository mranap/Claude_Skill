import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import {
  adminBlockUserSchema,
  adminCreateUserSchema,
  adminResetPasswordSchema,
  adminUpdateUserSchema,
  adminUserListQuerySchema,
  roleCreateSchema,
  roleUpdateSchema,
} from '@adpilot/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { AdminUsersService } from './admin-users.service';
import { RolesService } from './roles.service';
import type { AuthUser } from '../auth/auth.types';

const uuid = new ParseUUIDPipe();

@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @RequirePermissions('admin.users.view')
  list(@Query(zod(adminUserListQuerySchema)) q: z.infer<typeof adminUserListQuerySchema>) {
    return this.users.list(q);
  }

  @Get(':id')
  @RequirePermissions('admin.users.view')
  get(@CurrentUser() actor: AuthUser, @Param('id', uuid) id: string) {
    return this.users.get(id, actor);
  }

  @Post()
  @RequirePermissions('admin.users.create')
  create(
    @CurrentUser() actor: AuthUser,
    @Body(zod(adminCreateUserSchema)) body: z.infer<typeof adminCreateUserSchema>,
  ) {
    return this.users.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions('admin.users.update')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid) id: string,
    @Body(zod(adminUpdateUserSchema)) body: z.infer<typeof adminUpdateUserSchema>,
  ) {
    return this.users.update(actor, id, body);
  }

  @Post(':id/block')
  @HttpCode(200)
  @RequirePermissions('admin.users.block')
  async block(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid) id: string,
    @Body(zod(adminBlockUserSchema)) body: z.infer<typeof adminBlockUserSchema>,
  ) {
    await this.users.block(actor, id, body.reason);
    return { ok: true };
  }

  @Post(':id/unblock')
  @HttpCode(200)
  @RequirePermissions('admin.users.block')
  async unblock(@CurrentUser() actor: AuthUser, @Param('id', uuid) id: string) {
    await this.users.unblock(actor, id);
    return { ok: true };
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @RequirePermissions('admin.users.reset_password')
  async resetPassword(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid) id: string,
    @Body(zod(adminResetPasswordSchema)) body: z.infer<typeof adminResetPasswordSchema>,
  ) {
    await this.users.resetPassword(actor, id, body);
    return { ok: true };
  }

  @Post(':id/reset-2fa')
  @HttpCode(200)
  @RequirePermissions('admin.users.reset_password')
  async reset2fa(@CurrentUser() actor: AuthUser, @Param('id', uuid) id: string) {
    await this.users.resetTwoFactor(actor, id);
    return { ok: true };
  }

  @Post(':id/sessions/revoke')
  @HttpCode(200)
  @RequirePermissions('admin.users.sessions')
  async revokeAll(@CurrentUser() actor: AuthUser, @Param('id', uuid) id: string) {
    await this.users.revokeSessions(actor, id);
    return { ok: true };
  }

  @Delete(':id/sessions/:sessionId')
  @RequirePermissions('admin.users.sessions')
  async revokeOne(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid) id: string,
    @Param('sessionId', uuid) sessionId: string,
  ) {
    await this.users.revokeSessions(actor, id, sessionId);
    return { ok: true };
  }

  @Delete(':id')
  @RequirePermissions('admin.users.delete')
  async remove(@CurrentUser() actor: AuthUser, @Param('id', uuid) id: string) {
    await this.users.delete(actor, id);
    return { ok: true };
  }
}

@Controller('admin/roles')
export class AdminRolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions('admin.users.view')
  list() {
    return this.roles.list();
  }

  @Get('permissions')
  @RequirePermissions('admin.users.view')
  permissions() {
    return this.roles.permissions();
  }

  @Post()
  @RequirePermissions('admin.roles.manage')
  create(
    @CurrentUser() actor: AuthUser,
    @Body(zod(roleCreateSchema)) body: z.infer<typeof roleCreateSchema>,
  ) {
    return this.roles.create(actor, body);
  }

  @Patch(':id')
  @RequirePermissions('admin.roles.manage')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid) id: string,
    @Body(zod(roleUpdateSchema)) body: z.infer<typeof roleUpdateSchema>,
  ) {
    return this.roles.update(actor, id, body);
  }

  @Delete(':id')
  @RequirePermissions('admin.roles.manage')
  async remove(@CurrentUser() actor: AuthUser, @Param('id', uuid) id: string) {
    await this.roles.remove(actor, id);
    return { ok: true };
  }
}
