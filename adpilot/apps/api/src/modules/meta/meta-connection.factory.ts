import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ProxyInput } from '@adpilot/shared';
import { Aad, EncryptionService } from '../../infra/crypto/encryption.service';
import { SettingsService } from '../settings/settings.service';
import { AppError } from '../../common/errors/app-error';
import { NonPublicAddressError, assertPublicHost } from '../../common/net/public-address';
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

  private async privateProxiesAllowed(): Promise<boolean> {
    return (await this.settings.get('meta')).allowPrivateProxyAddresses;
  }

  /**
   * Returns a user-facing reason when the proxy host is not allowed (it resolves to a private/reserved
   * address and the administrator did not allow private proxies), or null. This early check gives a clear
   * message; the binding check runs again on every connection (`publicOnlyLookup` in the proxy agents).
   * Messages never contain resolved addresses, so the check cannot be used to map internal DNS.
   */
  async proxyPolicyViolation(host: string): Promise<string | null> {
    if (await this.privateProxiesAllowed()) return null;
    try {
      await assertPublicHost(host);
    } catch (err) {
      if (err instanceof NonPublicAddressError) {
        return `The proxy ${host} points to a private or reserved network address. Use a public proxy address, or ask the administrator to allow private proxy addresses.`;
      }
      return `The proxy host ${host} could not be resolved.`;
    }
    return null;
  }

  async assertProxyAllowed(host: string): Promise<void> {
    const reason = await this.proxyPolicyViolation(host);
    // Invalid input (not an upstream failure), hence 400 instead of the default 502 of PROXY_ERROR.
    if (reason) throw new AppError('PROXY_ERROR', reason, undefined, { status: 400 });
  }

  async forProfile(profile: ProfileWithProxy): Promise<MetaConnection> {
    if (!profile.tokenEnc) throw new AppError('META_AUTH_ERROR', 'This Meta profile has no access token');
    // Re-checked at connection time as well: DNS of a stored proxy host may change after it was saved.
    if (profile.proxy) await this.assertProxyAllowed(profile.proxy.host);
    const accessToken = this.encryption.decrypt(profile.tokenEnc, Aad.metaToken(profile.id));
    return {
      userId: profile.userId,
      profileId: profile.id,
      accessToken,
      appId: profile.tokenAppId ?? profile.appId,
      appSecret: await this.appSecretFor(profile),
      proxy: profile.proxy ? await this.proxyConfigFor(profile.proxy) : null,
    };
  }

  /** Connection for "test before save" calls; nothing is persisted. */
  async forTest(userId: string, input: { accessToken: string; proxy?: ProxyInput | null; appId?: string | null; appSecret?: string | null }): Promise<MetaConnection> {
    if (input.proxy) await this.assertProxyAllowed(input.proxy.host);
    return {
      userId,
      profileId: `test-${createHash('sha256').update(input.accessToken).digest('hex').slice(0, 16)}`,
      accessToken: input.accessToken,
      appId: input.appId ?? null,
      appSecret: input.appSecret ?? null,
      proxy: input.proxy ? await this.proxyConfigFromInput(input.proxy) : null,
    };
  }

  /** Connection settings of a saved proxy, with the connect-time address policy applied. */
  async proxyConfigFor(p: Proxy): Promise<ProxyConfig> {
    return {
      type: p.type,
      host: p.host,
      port: p.port,
      username: p.username,
      password: this.encryption.decryptNullable(p.passwordEnc, Aad.proxyPassword(p.id)),
      allowPrivateAddress: await this.privateProxiesAllowed(),
    };
  }

  /** Connection settings of a proxy that is being tested before it is saved. */
  async proxyConfigFromInput(p: ProxyInput): Promise<ProxyConfig> {
    return {
      type: p.type,
      host: p.host,
      port: p.port,
      username: p.username ?? null,
      password: p.password ?? null,
      allowPrivateAddress: await this.privateProxiesAllowed(),
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
