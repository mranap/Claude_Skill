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
import {
  changeEmailSchema,
  changePasswordSchema,
  disable2faSchema,
  enable2faSchema,
  paginationQuerySchema,
  totpCodeSchema,
  updateProfileSchema,
} from '@adpilot/shared';
import { z } from 'zod';
import { AllowPendingPasswordChange, CurrentUser } from '../../common/decorators/auth.decorators';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from './auth.service';
import { AuthCacheService } from './auth-cache.service';
import { SessionService } from './session.service';
import { TwoFactorService } from './two-factor.service';
import type { AuthUser } from './auth.types';

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Self-service account management for the signed-in user. */
@Controller('account')
export class AccountController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly twoFactor: TwoFactorService,
    private readonly cache: AuthCacheService,
    private readonly audit: AuditService,
  ) {}

  @Patch('profile')
  async updateProfile(
    @CurrentUser() user: AuthUser,
    @Body(zod(updateProfileSchema)) body: z.infer<typeof updateProfileSchema>,
  ) {
    if (body.timezone && !isValidTimezone(body.timezone)) {
      throw AppError.validation('Unknown time zone', [{ path: 'timezone', message: 'Unknown time zone' }]);
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.timezone ? { timezone: body.timezone } : {}),
      },
    });
    await this.cache.invalidateUser(user.id);
    return this.auth.me(user.id);
  }

  @AllowPendingPasswordChange()
  @Post('password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(zod(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
  ) {
    await this.auth.changePassword(user, body.currentPassword, body.newPassword);
    return { ok: true };
  }

  @Post('email')
  @HttpCode(202)
  async changeEmail(
    @CurrentUser() user: AuthUser,
    @Body(zod(changeEmailSchema)) body: z.infer<typeof changeEmailSchema>,
  ) {
    await this.auth.requestEmailChange(user, body.newEmail, body.password);
    return { ok: true, message: 'We sent a confirmation link to the new address.' };
  }

  @Get('sessions')
  async listSessions(@CurrentUser() user: AuthUser) {
    const sessions = await this.sessions.listActive(user.id);
    return sessions.map((s) => ({ ...s, current: s.id === user.sessionId }));
  }

  @Delete('sessions/:id')
  async revokeSession(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    const s = await this.prisma.session.findFirst({ where: { id, userId: user.id } });
    if (!s) throw AppError.notFound('Session');
    await this.sessions.revoke(id, 'revoked_by_user');
    await this.audit.log({
      action: 'auth.session.revoked',
      actorUserId: user.id,
      subjectUserId: user.id,
      targetType: 'session',
      targetId: id,
    });
    return { ok: true };
  }

  @Post('sessions/revoke-others')
  @HttpCode(200)
  async revokeOthers(@CurrentUser() user: AuthUser) {
    const count = await this.sessions.revokeAllForUser(user.id, 'revoked_by_user', user.sessionId);
    await this.audit.log({
      action: 'auth.session.revoked_others',
      actorUserId: user.id,
      subjectUserId: user.id,
      metadata: { count },
    });
    return { revoked: count };
  }

  @Get('login-history')
  async loginHistory(
    @CurrentUser() user: AuthUser,
    @Query(zod(paginationQuerySchema)) q: z.infer<typeof paginationQuerySchema>,
  ) {
    const where = { userId: user.id };
    const [items, total] = await Promise.all([
      this.prisma.loginEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: { id: true, success: true, reason: true, ip: true, userAgent: true, createdAt: true },
      }),
      this.prisma.loginEvent.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  @Post('2fa/setup')
  @HttpCode(200)
  setup2fa(@CurrentUser() user: AuthUser) {
    return this.twoFactor.setup(user);
  }

  @Post('2fa/enable')
  @HttpCode(200)
  enable2fa(
    @CurrentUser() user: AuthUser,
    @Body(zod(enable2faSchema)) body: z.infer<typeof enable2faSchema>,
  ) {
    return this.twoFactor.enable(user, body.code);
  }

  @Post('2fa/disable')
  @HttpCode(200)
  async disable2fa(
    @CurrentUser() user: AuthUser,
    @Body(zod(disable2faSchema)) body: z.infer<typeof disable2faSchema>,
  ) {
    await this.twoFactor.disable(user, body.password, body.code);
    return { ok: true };
  }

  @Post('2fa/recovery-codes')
  @HttpCode(200)
  regenerateCodes(
    @CurrentUser() user: AuthUser,
    @Body(zod(z.object({ code: totpCodeSchema }))) body: { code: string },
  ) {
    return this.twoFactor.regenerateRecoveryCodes(user, body.code);
  }
}
