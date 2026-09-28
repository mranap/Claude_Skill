import { Injectable } from '@nestjs/common';
import { SYSTEM_ROLES, isAdminRole, type AuthUserDto, type LoginResponse } from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { HashingService } from '../../infra/crypto/hashing.service';
import { Aad, EncryptionService } from '../../infra/crypto/encryption.service';
import { RateLimiterService } from '../../infra/locks/rate-limiter.service';
import { RedisService } from '../../infra/redis/redis.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppError } from '../../common/errors/app-error';
import { AuthCacheService } from './auth-cache.service';
import { IssuedSession, SessionService } from './session.service';
import { verifyTotp } from './totp';
import type { AuthUser, ClientInfo } from './auth.types';

const INVALID_CREDENTIALS = 'Invalid email or password';
const INVALID_RESET_LINK = 'This link is invalid or has expired. Please request a new one.';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
    private readonly encryption: EncryptionService,
    private readonly sessions: SessionService,
    private readonly settings: SettingsService,
    private readonly rateLimiter: RateLimiterService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly cache: AuthCacheService,
  ) {}

  // ───────────────────────────── Login ─────────────────────────────

  async login(
    email: string,
    password: string,
    client: ClientInfo,
  ): Promise<{ response: LoginResponse; session?: IssuedSession }> {
    const security = await this.settings.get('security');
    await this.enforceRateLimit('login-ip', client.ip ?? 'unknown', security.loginRateLimitPerMinute, 60);
    await this.enforceRateLimit('login-email', email, 10, 15 * 60);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status === 'DELETED') {
      await this.hashing.verifyDummy(password);
      await this.recordLogin(null, email, false, 'unknown_email', client);
      throw new AppError('UNAUTHORIZED', INVALID_CREDENTIALS);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.recordLogin(user.id, email, false, 'locked', client);
      const retry = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
      throw new AppError(
        'ACCOUNT_LOCKED',
        `Too many failed sign-in attempts. Try again in ${Math.ceil(retry / 60)} minute(s).`,
        undefined,
        { retryAfterSeconds: retry },
      );
    }

    const valid = await this.hashing.verifyPassword(user.passwordHash, password);
    if (!valid) {
      const failed = await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: { increment: 1 } },
        select: { failedLoginCount: true },
      });
      if (failed.failedLoginCount >= security.maxFailedLogins) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { lockedUntil: new Date(Date.now() + security.lockoutMinutes * 60_000), failedLoginCount: 0 },
        });
        await this.audit.log({ action: 'auth.account.locked', subjectUserId: user.id, actorEmail: email, ip: client.ip });
      }
      await this.recordLogin(user.id, email, false, 'bad_password', client);
      await this.audit.log({
        action: 'auth.login.failed',
        actorEmail: email,
        subjectUserId: user.id,
        actorType: 'USER',
        ip: client.ip,
        userAgent: client.userAgent,
      });
      throw new AppError('UNAUTHORIZED', INVALID_CREDENTIALS);
    }

    if (user.status === 'BLOCKED') {
      await this.recordLogin(user.id, email, false, 'blocked', client);
      throw new AppError('ACCOUNT_BLOCKED', 'Your account has been blocked. Please contact the administrator.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        ...(this.hashing.needsRehash(user.passwordHash) ? { passwordHash: await this.hashing.hashPassword(password) } : {}),
      },
    });
    await this.rateLimiter.reset('login-email', email);

    if (user.twoFactorEnabled) {
      const { ticket } = this.sessions.signMfaTicket(user.id);
      await this.recordLogin(user.id, email, true, 'password_ok_mfa_pending', client);
      return { response: { status: 'MFA_REQUIRED', ticket } };
    }
    const session = await this.completeLogin(user.id, email, client, 'password');
    return { response: { status: 'OK', user: await this.me(user.id) }, session };
  }

  async verifyMfa(ticket: string, code: string, client: ClientInfo) {
    const parsed = this.sessions.verifyMfaTicket(ticket);
    if (!parsed) throw new AppError('MFA_INVALID', 'The verification step expired. Please sign in again.');
    await this.enforceRateLimit('mfa', parsed.jti, 5, 300);

    const user = await this.prisma.user.findUnique({ where: { id: parsed.userId } });
    if (!user || user.status !== 'ACTIVE' || !user.twoFactorEnabled || !user.twoFactorSecretEnc) {
      throw new AppError('MFA_INVALID', 'The verification step expired. Please sign in again.');
    }
    const ok = await this.checkSecondFactor(user.id, user.twoFactorSecretEnc, user.twoFactorRecoveryHashes, code);
    if (!ok) {
      await this.recordLogin(user.id, user.email, false, 'bad_totp', client);
      throw new AppError('MFA_INVALID', 'Invalid verification code');
    }
    // The ticket is single-use.
    const fresh = await this.redis.client.set(this.redis.key('auth', 'mfa-used', parsed.jti), '1', 'EX', 600, 'NX');
    if (fresh !== 'OK') throw new AppError('MFA_INVALID', 'The verification step expired. Please sign in again.');

    const session = await this.completeLogin(user.id, user.email, client, 'password+totp');
    return { user: await this.me(user.id), session };
  }

  /** Verifies a TOTP code (with replay protection) or consumes a recovery code. */
  async checkSecondFactor(userId: string, secretEnc: string, recoveryHashes: string[], code: string): Promise<boolean> {
    const trimmed = code.trim();
    if (/^\d{6}$/.test(trimmed)) {
      const secret = this.encryption.decrypt(secretEnc, Aad.totpSecret(userId));
      const step = verifyTotp(secret, trimmed);
      if (step === null) return false;
      const unused = await this.redis.client.set(this.redis.key('auth', 'totp-step', userId, step), '1', 'EX', 120, 'NX');
      return unused === 'OK';
    }
    const hash = this.hashing.sha256(trimmed.toLowerCase());
    if (!recoveryHashes.includes(hash)) return false;
    // Atomic removal: only succeeds if the code is still present.
    const updated = await this.prisma.$executeRaw`
      UPDATE users SET "twoFactorRecoveryHashes" = array_remove("twoFactorRecoveryHashes", ${hash})
      WHERE id = ${userId}::uuid AND ${hash} = ANY("twoFactorRecoveryHashes")`;
    if (updated === 1) {
      await this.audit.log({ action: 'auth.2fa.recovery_code_used', subjectUserId: userId, actorUserId: userId });
      return true;
    }
    return false;
  }

  private async completeLogin(userId: string, email: string, client: ClientInfo, method: string) {
    const session = await this.sessions.create(userId, client);
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date(), lastLoginIp: client.ip ?? null },
    });
    await this.recordLogin(userId, email, true, method, client);
    await this.audit.log({
      action: 'auth.login.success',
      actorUserId: userId,
      actorEmail: email,
      subjectUserId: userId,
      targetType: 'session',
      targetId: session.sessionId,
      metadata: { method },
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return session;
  }

  async refresh(refreshToken: string | undefined, client: ClientInfo): Promise<IssuedSession> {
    if (!refreshToken) throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
    return this.sessions.rotate(refreshToken, client);
  }

  async logout(user: AuthUser | undefined, refreshToken: string | undefined): Promise<void> {
    if (user) {
      await this.sessions.revoke(user.sessionId, 'logout');
      await this.audit.log({ action: 'auth.logout', actorUserId: user.id, targetType: 'session', targetId: user.sessionId });
      return;
    }
    if (refreshToken) {
      const s = await this.prisma.session.findUnique({ where: { refreshTokenHash: this.hashing.sha256(refreshToken) } });
      if (s) await this.sessions.revoke(s.id, 'logout');
    }
  }

  async me(userId: string): Promise<AuthUserDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    const permissions =
      user.role.key === SYSTEM_ROLES.SUPER_ADMIN
        ? (await this.prisma.permission.findMany({ select: { key: true } })).map((p) => p.key)
        : user.role.permissions.map((p) => p.permission.key);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role.key,
      permissions,
      timezone: user.timezone,
      twoFactorEnabled: user.twoFactorEnabled,
      mustChangePassword: user.mustChangePassword,
      isAdmin: isAdminRole(user.role.key, permissions),
    };
  }

  // ───────────────────────────── Passwords ─────────────────────────────

  async forgotPassword(email: string, client: ClientInfo): Promise<void> {
    await this.enforceRateLimit('forgot-ip', client.ip ?? 'unknown', 10, 15 * 60);
    const perEmail = await this.rateLimiter.hit('forgot-email', email, 3, 3600_000);
    if (!perEmail.allowed) return; // silently ignore to avoid enumeration

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return;

    const security = await this.settings.get('security');
    const token = this.hashing.randomToken(32);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: this.hashing.sha256(token),
          purpose: 'RESET',
          expiresAt: new Date(Date.now() + security.passwordResetTtlMinutes * 60_000),
          requestedIp: client.ip ?? null,
        },
      }),
    ]);
    await this.mail.sendPasswordReset(user.email, token, security.passwordResetTtlMinutes, user.id);
    await this.audit.log({ action: 'auth.password.reset_requested', subjectUserId: user.id, actorEmail: email, ip: client.ip });
  }

  async validateResetToken(token: string): Promise<{ valid: boolean; purpose?: string }> {
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: this.hashing.sha256(token) } });
    const valid = !!row && !row.usedAt && row.expiresAt > new Date();
    return valid ? { valid, purpose: row!.purpose } : { valid: false };
  }

  /** Consumes a one-time reset/invitation token atomically and sets the new password. */
  async resetPassword(token: string, newPassword: string, client: ClientInfo): Promise<void> {
    await this.enforceRateLimit('reset-ip', client.ip ?? 'unknown', 20, 15 * 60);
    const tokenHash = this.hashing.sha256(token);
    const passwordHash = await this.hashing.hashPassword(newPassword);

    const userId = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) return null;
      const row = await tx.passwordResetToken.findUniqueOrThrow({ where: { tokenHash } });
      const user = await tx.user.findUnique({ where: { id: row.userId } });
      if (!user || user.status !== 'ACTIVE') return null;
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      return user.id;
    });
    if (!userId) throw new AppError('BAD_REQUEST', INVALID_RESET_LINK);

    await this.sessions.revokeAllForUser(userId, 'password_reset');
    await this.cache.invalidateUser(userId);
    await this.audit.log({ action: 'auth.password.reset', subjectUserId: userId, actorUserId: userId, ip: client.ip });
    await this.notifications.notify({
      userId,
      type: 'SECURITY_ALERT',
      severity: 'WARNING',
      title: 'Your password was changed',
      body: 'The password of your account was reset. All other sessions were signed out.',
    });
  }

  async changePassword(user: AuthUser, currentPassword: string, newPassword: string): Promise<void> {
    await this.enforceRateLimit('change-password', user.id, 10, 15 * 60);
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await this.hashing.verifyPassword(row.passwordHash, currentPassword))) {
      throw AppError.validation('Current password is incorrect', [{ path: 'currentPassword', message: 'Incorrect password' }]);
    }
    if (await this.hashing.verifyPassword(row.passwordHash, newPassword)) {
      throw AppError.validation('The new password must be different', [{ path: 'newPassword', message: 'Choose a new password' }]);
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await this.hashing.hashPassword(newPassword),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    });
    await this.sessions.revokeAllForUser(user.id, 'password_changed', user.sessionId);
    await this.cache.invalidateUser(user.id);
    await this.audit.log({ action: 'auth.password.changed', actorUserId: user.id, subjectUserId: user.id });
    await this.notifications.notify({
      userId: user.id,
      type: 'SECURITY_ALERT',
      severity: 'WARNING',
      title: 'Your password was changed',
      body: 'Your password was changed. Other sessions were signed out.',
    });
  }

  // ───────────────────────────── E-mail change ─────────────────────────────

  async requestEmailChange(user: AuthUser, newEmail: string, password: string): Promise<void> {
    await this.enforceRateLimit('email-change', user.id, 5, 3600);
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await this.hashing.verifyPassword(row.passwordHash, password))) {
      throw AppError.validation('Password is incorrect', [{ path: 'password', message: 'Incorrect password' }]);
    }
    if (newEmail === row.email) throw AppError.validation('This is already your e-mail address');
    const taken = await this.prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } });
    if (taken) throw AppError.conflict('This e-mail address is already used by another account');

    const token = this.hashing.randomToken(32);
    await this.prisma.$transaction([
      this.prisma.emailChangeToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.emailChangeToken.create({
        data: {
          userId: user.id,
          newEmail,
          tokenHash: this.hashing.sha256(token),
          expiresAt: new Date(Date.now() + 24 * 3600_000),
        },
      }),
    ]);
    await this.mail.sendEmailChangeConfirmation(newEmail, token, user.id);
    await this.audit.log({ action: 'auth.email.change_requested', actorUserId: user.id, subjectUserId: user.id, metadata: { newEmail } });
  }

  async confirmEmailChange(token: string): Promise<void> {
    const tokenHash = this.hashing.sha256(token);
    const result = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.emailChangeToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) return null;
      const row = await tx.emailChangeToken.findUniqueOrThrow({ where: { tokenHash } });
      const user = await tx.user.findUniqueOrThrow({ where: { id: row.userId } });
      const taken = await tx.user.findUnique({ where: { email: row.newEmail }, select: { id: true } });
      if (taken || user.status !== 'ACTIVE') return null;
      await tx.user.update({ where: { id: user.id }, data: { email: row.newEmail } });
      return { userId: user.id, oldEmail: user.email, newEmail: row.newEmail };
    });
    if (!result) throw new AppError('BAD_REQUEST', INVALID_RESET_LINK);
    await this.cache.invalidateUser(result.userId);
    await this.audit.log({
      action: 'auth.email.changed',
      actorUserId: result.userId,
      subjectUserId: result.userId,
      metadata: { oldEmail: result.oldEmail, newEmail: result.newEmail },
    });
    await this.mail.sendSecurityNotice(
      result.oldEmail,
      'Your login e-mail was changed',
      `The e-mail address of your account was changed to ${result.newEmail}.`,
      result.userId,
    );
  }

  // ───────────────────────────── Helpers ─────────────────────────────

  private async enforceRateLimit(bucket: string, id: string, limit: number, windowSeconds: number): Promise<void> {
    const res = await this.rateLimiter.hit(bucket, id, limit, windowSeconds * 1000);
    if (!res.allowed) throw AppError.rateLimited(Math.ceil(res.retryAfterMs / 1000));
  }

  private async recordLogin(userId: string | null, email: string, success: boolean, reason: string, client: ClientInfo) {
    await this.prisma.loginEvent.create({
      data: {
        userId,
        email,
        success,
        reason,
        ip: client.ip ?? null,
        userAgent: client.userAgent?.slice(0, 500) ?? null,
      },
    });
  }
}
