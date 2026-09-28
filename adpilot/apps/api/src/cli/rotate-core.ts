import { SECRET_SETTING_FIELDS, type SettingKey } from '@adpilot/shared';
import { Aad, EncryptionService } from '../infra/crypto/encryption.service';
import { Prisma, type PrismaClient } from '../generated/prisma/client';

export interface RotationReport {
  metaTokens: number;
  metaAppSecrets: number;
  proxyPasswords: number;
  totpSecrets: number;
  settingSecrets: number;
}

const BATCH = 200;

/**
 * Re-encrypts every stored secret that is not yet encrypted with the active key (ENCRYPTION_ACTIVE_KEY_ID).
 * Safe to run while the platform is online and to re-run: each row is updated only if its ciphertext is still
 * the one that was read (compare-and-set), so concurrent changes are never overwritten.
 */
export async function rotateEncryptedData(prisma: PrismaClient, enc: EncryptionService): Promise<RotationReport> {
  const report: RotationReport = { metaTokens: 0, metaAppSecrets: 0, proxyPasswords: 0, totpSecrets: 0, settingSecrets: 0 };
  const rotate = (value: string | null, aad: string): string | null => (value && enc.needsRotation(value) ? enc.encrypt(enc.decrypt(value, aad), aad) : null);

  for (let cursor: string | undefined; ; ) {
    const rows = await prisma.metaProfile.findMany({
      select: { id: true, tokenEnc: true, appSecretEnc: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!rows.length) break;
    for (const r of rows) {
      const token = rotate(r.tokenEnc, Aad.metaToken(r.id));
      if (token) report.metaTokens += (await prisma.metaProfile.updateMany({ where: { id: r.id, tokenEnc: r.tokenEnc }, data: { tokenEnc: token } })).count;
      const secret = rotate(r.appSecretEnc, Aad.metaAppSecret(r.id));
      if (secret) report.metaAppSecrets += (await prisma.metaProfile.updateMany({ where: { id: r.id, appSecretEnc: r.appSecretEnc }, data: { appSecretEnc: secret } })).count;
    }
    cursor = rows[rows.length - 1]!.id;
  }

  for (let cursor: string | undefined; ; ) {
    const rows = await prisma.proxy.findMany({ select: { id: true, passwordEnc: true }, orderBy: { id: 'asc' }, take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    if (!rows.length) break;
    for (const r of rows) {
      const pw = rotate(r.passwordEnc, Aad.proxyPassword(r.id));
      if (pw) report.proxyPasswords += (await prisma.proxy.updateMany({ where: { id: r.id, passwordEnc: r.passwordEnc }, data: { passwordEnc: pw } })).count;
    }
    cursor = rows[rows.length - 1]!.id;
  }

  for (let cursor: string | undefined; ; ) {
    const rows = await prisma.user.findMany({
      where: { OR: [{ twoFactorSecretEnc: { not: null } }, { twoFactorPendingSecretEnc: { not: null } }] },
      select: { id: true, twoFactorSecretEnc: true, twoFactorPendingSecretEnc: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!rows.length) break;
    for (const r of rows) {
      const active = rotate(r.twoFactorSecretEnc, Aad.totpSecret(r.id));
      if (active) report.totpSecrets += (await prisma.user.updateMany({ where: { id: r.id, twoFactorSecretEnc: r.twoFactorSecretEnc }, data: { twoFactorSecretEnc: active } })).count;
      const pending = rotate(r.twoFactorPendingSecretEnc, Aad.totpPendingSecret(r.id));
      if (pending) report.totpSecrets += (await prisma.user.updateMany({ where: { id: r.id, twoFactorPendingSecretEnc: r.twoFactorPendingSecretEnc }, data: { twoFactorPendingSecretEnc: pending } })).count;
    }
    cursor = rows[rows.length - 1]!.id;
  }

  for (const [key, fields] of Object.entries(SECRET_SETTING_FIELDS) as [SettingKey, readonly string[]][]) {
    await prisma.$transaction(async (tx) => {
      // Row lock: a concurrent settings update waits instead of being overwritten.
      const rows = await tx.$queryRaw<{ value: Record<string, unknown> }[]>`SELECT value FROM system_settings WHERE key = ${key} FOR UPDATE`;
      const value = rows[0]?.value;
      if (!value) return;
      let changed = 0;
      for (const field of fields) {
        const current = typeof value[field] === 'string' ? (value[field] as string) : null;
        const next = rotate(current, Aad.setting(`${key}.${field}`));
        if (next) {
          value[field] = next;
          changed++;
        }
      }
      if (changed) {
        await tx.systemSetting.update({ where: { key }, data: { value: value as Prisma.InputJsonValue } });
        report.settingSecrets += changed;
      }
    });
  }
  return report;
}
