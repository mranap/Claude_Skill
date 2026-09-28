import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Aad, EncryptionService } from '../../infra/crypto/encryption.service';
import { HashingService } from '../../infra/crypto/hashing.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppError } from '../../common/errors/app-error';
import { AuthCacheService } from './auth-cache.service';
import { AuthService } from './auth.service';
import { generateRecoveryCodes, generateTotpSecret, otpauthUrl, verifyTotp } from './totp';
import type { AuthUser } from './auth.types';

@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly hashing: HashingService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly cache: AuthCacheService,
    private readonly auth: AuthService,
  ) {}

  /** Step 1: create a pending secret and return the provisioning URI + QR code. */
  async setup(user: AuthUser): Promise<{ otpauthUrl: string; qrDataUrl: string; secret: string }> {
    if (user.twoFactorEnabled) throw AppError.conflict('Two-factor authentication is already enabled');
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { twoFactorPendingSecretEnc: this.encryption.encrypt(secret, Aad.totpPendingSecret(user.id)) },
    });
    const issuer = (await this.settings.get('general')).platformName;
    const url = otpauthUrl({ secret, account: user.email, issuer });
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 220 });
    return { otpauthUrl: url, qrDataUrl, secret };
  }

  /** Step 2: confirm with a code from the authenticator app; returns one-time recovery codes. */
  async enable(user: AuthUser, code: string): Promise<{ recoveryCodes: string[] }> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (row.twoFactorEnabled) throw AppError.conflict('Two-factor authentication is already enabled');
    if (!row.twoFactorPendingSecretEnc) throw AppError.validation('Start the setup again');
    const secret = this.encryption.decrypt(row.twoFactorPendingSecretEnc, Aad.totpPendingSecret(user.id));
    if (verifyTotp(secret, code) === null) {
      throw AppError.validation('Invalid code', [{ path: 'code', message: 'The code does not match. Check the time on your phone.' }]);
    }
    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorEnabled: true,
        twoFactorSecretEnc: this.encryption.encrypt(secret, Aad.totpSecret(user.id)),
        twoFactorPendingSecretEnc: null,
        twoFactorRecoveryHashes: recoveryCodes.map((c) => this.hashing.sha256(c)),
      },
    });
    await this.cache.invalidateUser(user.id);
    await this.audit.log({ action: 'auth.2fa.enabled', actorUserId: user.id, subjectUserId: user.id });
    await this.notifications.notify({
      userId: user.id,
      type: 'SECURITY_ALERT',
      severity: 'INFO',
      title: 'Two-factor authentication enabled',
      body: 'Two-factor authentication is now required when you sign in.',
    });
    return { recoveryCodes };
  }

  async disable(user: AuthUser, password: string, code: string): Promise<void> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!row.twoFactorEnabled || !row.twoFactorSecretEnc) throw AppError.conflict('Two-factor authentication is not enabled');
    if (!(await this.hashing.verifyPassword(row.passwordHash, password))) {
      throw AppError.validation('Password is incorrect', [{ path: 'password', message: 'Incorrect password' }]);
    }
    if (!(await this.auth.checkSecondFactor(user.id, row.twoFactorSecretEnc, row.twoFactorRecoveryHashes, code))) {
      throw AppError.validation('Invalid code', [{ path: 'code', message: 'Invalid code' }]);
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false, twoFactorSecretEnc: null, twoFactorRecoveryHashes: [] },
    });
    await this.cache.invalidateUser(user.id);
    await this.audit.log({ action: 'auth.2fa.disabled', actorUserId: user.id, subjectUserId: user.id });
    await this.notifications.notify({
      userId: user.id,
      type: 'SECURITY_ALERT',
      severity: 'WARNING',
      title: 'Two-factor authentication disabled',
      body: 'Two-factor authentication was turned off for your account.',
    });
  }

  async regenerateRecoveryCodes(user: AuthUser, code: string): Promise<{ recoveryCodes: string[] }> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!row.twoFactorEnabled || !row.twoFactorSecretEnc) throw AppError.conflict('Two-factor authentication is not enabled');
    if (!(await this.auth.checkSecondFactor(user.id, row.twoFactorSecretEnc, [], code))) {
      throw AppError.validation('Invalid code', [{ path: 'code', message: 'Enter a code from your authenticator app' }]);
    }
    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { twoFactorRecoveryHashes: recoveryCodes.map((c) => this.hashing.sha256(c)) },
    });
    await this.audit.log({ action: 'auth.2fa.recovery_codes_regenerated', actorUserId: user.id, subjectUserId: user.id });
    return { recoveryCodes };
  }
}
