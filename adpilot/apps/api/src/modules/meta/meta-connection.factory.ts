import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ProxyInput } from '@adpilot/shared';
import { Aad, EncryptionService } from '../../infra/crypto/encryption.service';
import { SettingsService } from '../settings/settings.service';
import { AppError } from '../../common/errors/app-error';
import type { MetaConnection } from './graph/meta-graph.client';
import type { ProxyConfig } from './graph/proxy-agents';
import type { MetaProfile, Proxy } from '../../generated/prisma/client';

export type ProfileWithProxy = MetaProfile & { proxy: Proxy | null };

/**
 * Builds the in-memory connection (decrypted token, app secret, proxy credentials) for a Meta profile.
 * Decrypted secrets live only in memory for the duration of a request/job and are never logged.
 */
@Injectable()
export class MetaConnectionFactory {
  constructor(
    private readonly encryption: EncryptionService,
    private readonly settings: SettingsService,
  ) {}

  async forProfile(profile: ProfileWithProxy): Promise<MetaConnection> {
    if (!profile.tokenEnc) throw new AppError('META_AUTH_ERROR', 'This Meta profile has no access token');
    const accessToken = this.encryption.decrypt(profile.tokenEnc, Aad.metaToken(profile.id));
    return {
      userId: profile.userId,
      profileId: profile.id,
      accessToken,
      appId: profile.tokenAppId ?? profile.appId,
      appSecret: await this.appSecretFor(profile),
      proxy: profile.proxy ? this.proxyConfig(profile.proxy) : null,
    };
  }

  /** Connection for "test before save" calls; nothing is persisted. */
  forTest(userId: string, input: { accessToken: string; proxy?: ProxyInput | null; appId?: string | null; appSecret?: string | null }): MetaConnection {
    return {
      userId,
      profileId: `test-${createHash('sha256').update(input.accessToken).digest('hex').slice(0, 16)}`,
      accessToken: input.accessToken,
      appId: input.appId ?? null,
      appSecret: input.appSecret ?? null,
      proxy: input.proxy
        ? { type: input.proxy.type, host: input.proxy.host, port: input.proxy.port, username: input.proxy.username ?? null, password: input.proxy.password ?? null }
        : null,
    };
  }

  proxyConfig(p: Proxy): ProxyConfig {
    return {
      type: p.type,
      host: p.host,
      port: p.port,
      username: p.username,
      password: this.encryption.decryptNullable(p.passwordEnc, Aad.proxyPassword(p.id)),
    };
  }

  /**
   * appsecret_proof must be signed with the secret of the app that issued the token. We only use a secret
   * when the token's app id (from debug_token) matches the app the secret belongs to.
   */
  private async appSecretFor(profile: MetaProfile): Promise<string | null> {
    if (profile.appSecretEnc && (!profile.tokenAppId || profile.tokenAppId === profile.appId)) {
      return this.encryption.decrypt(profile.appSecretEnc, Aad.metaAppSecret(profile.id));
    }
    const global = await this.settings.get('meta');
    if (global.appId && profile.tokenAppId === global.appId) {
      return this.settings.getSecret('meta', 'appSecret');
    }
    return null;
  }
}
