import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rotateEncryptedData } from '../../src/cli/rotate-core';
import { createCliPrisma } from '../../src/cli/cli-prisma';
import { Aad, EncryptionService } from '../../src/infra/crypto/encryption.service';
import type { AppConfig } from '../../src/config/app-config';
import { base32Decode, hotp } from '../../src/modules/auth/totp';
import { TestStack } from '../support/harness';
import { expectStatus } from '../support/http-client';

const service = (keys: string, active: string) => new EncryptionService({ env: { ENCRYPTION_KEYS: keys, ENCRYPTION_ACTIVE_KEY_ID: active } } as unknown as AppConfig);

describe('encryption key rotation', () => {
  const stack = new TestStack();
  let token: string;

  beforeAll(async () => {
    await stack.start({ worker: false });
    await stack.setSettings('meta', { allowPrivateProxyAddresses: true });
    await stack.configureSmtp();
    const admin = await stack.loginSuperAdmin();
    const user = await stack.createUser(admin);
    token = stack.meta.seed().token;
    expectStatus(
      await user.client.post('/api/meta-profiles', {
        name: 'Rotating',
        accessToken: token,
        appId: '123456789012345',
        appSecret: 'a'.repeat(32),
        proxy: { type: 'HTTP', host: '127.0.0.1', port: 3128, username: 'u', password: 'proxy-pass' },
      }),
      201,
    );
    const setup = expectStatus(await user.client.post('/api/account/2fa/setup'), 200).body;
    expectStatus(await user.client.post('/api/account/2fa/enable', { code: hotp(base32Decode(setup.secret), Math.floor(Date.now() / 30_000)) }), 200);
  });
  afterAll(() => stack.stop());

  it('re-encrypts every secret with the new key, idempotently', async () => {
    const [oldId, oldKey] = process.env.ENCRYPTION_KEYS!.split(':') as [string, string];
    const newKey = randomBytes(32).toString('base64');
    const rotating = service(`${oldId}:${oldKey},t2:${newKey}`, 't2');
    const prisma = createCliPrisma();
    try {
      const report = await rotateEncryptedData(prisma, rotating);
      expect(report).toEqual({ metaTokens: 1, metaAppSecrets: 1, proxyPasswords: 1, totpSecrets: 1, settingSecrets: 1 });
      expect(await rotateEncryptedData(prisma, rotating)).toEqual({ metaTokens: 0, metaAppSecrets: 0, proxyPasswords: 0, totpSecrets: 0, settingSecrets: 0 });

      // The old key can now be removed: everything decrypts with the new key alone.
      const onlyNew = service(`t2:${newKey}`, 't2');
      const profile = await prisma.metaProfile.findFirstOrThrow({ include: { proxy: true } });
      expect(onlyNew.decrypt(profile.tokenEnc!, Aad.metaToken(profile.id))).toBe(token);
      expect(onlyNew.decrypt(profile.appSecretEnc!, Aad.metaAppSecret(profile.id))).toBe('a'.repeat(32));
      expect(onlyNew.decrypt(profile.proxy!.passwordEnc!, Aad.proxyPassword(profile.proxy!.id))).toBe('proxy-pass');
      const user = await prisma.user.findFirstOrThrow({ where: { twoFactorEnabled: true } });
      expect(onlyNew.decrypt(user.twoFactorSecretEnc!, Aad.totpSecret(user.id))).toMatch(/^[A-Z2-7]+$/);
      const smtp = await prisma.systemSetting.findUniqueOrThrow({ where: { key: 'smtp' } });
      expect(onlyNew.decrypt((smtp.value as { password: string }).password, Aad.setting('smtp.password'))).toBe('smtp-test-password');
    } finally {
      await prisma.$disconnect();
    }
  });
});
