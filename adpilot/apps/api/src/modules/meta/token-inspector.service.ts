import { Injectable } from '@nestjs/common';
import axios from 'axios';
import {
  META_RECOMMENDED_PERMISSIONS,
  META_REQUIRED_PERMISSIONS,
  type ProxyTestResult,
  type TokenInspection,
} from '@adpilot/shared';
import { AppConfig } from '../../config/app-config';
import { MetaConnection, MetaGraphClient } from './graph/meta-graph.client';
import { MetaApiError } from './graph/meta-errors';
import { agentOptions, ProxyConfig } from './graph/proxy-agents';

interface DebugTokenData {
  app_id?: string;
  application?: string;
  type?: string;
  expires_at?: number;
  data_access_expires_at?: number;
  is_valid?: boolean;
  scopes?: string[];
  user_id?: string;
  error?: { code?: number; message?: string; subcode?: number };
}

/**
 * Validates Meta access tokens: identity (/me), granted permissions (/me/permissions) and token metadata
 * (/debug_token: type, app, expiry). Works for user tokens and Business Manager system-user tokens.
 */
@Injectable()
export class TokenInspectorService {
  constructor(
    private readonly graph: MetaGraphClient,
    private readonly config: AppConfig,
  ) {}

  async inspect(conn: MetaConnection): Promise<TokenInspection> {
    const started = Date.now();
    let me: { id: string; name?: string };
    try {
      me = await this.graph.get(conn, '/me', { fields: 'id,name' }, 'token.me', { safeToRetry: false });
    } catch (err) {
      return this.fromError(err);
    }

    let scopes: string[] = [];
    try {
      const perms = await this.graph.get<{ data: { permission: string; status: string }[] }>(conn, '/me/permissions', {}, 'token.permissions');
      scopes = perms.data.filter((p) => p.status === 'granted').map((p) => p.permission);
    } catch {
      /* some token types cannot read /me/permissions — debug_token below still lists scopes */
    }

    let debug: DebugTokenData | undefined;
    try {
      const res = await this.graph.get<{ data: DebugTokenData }>(conn, '/debug_token', { input_token: conn.accessToken }, 'token.debug');
      debug = res.data;
      if (!scopes.length && debug.scopes) scopes = debug.scopes;
    } catch {
      /* debug_token is optional metadata */
    }

    const missingRequired = META_REQUIRED_PERMISSIONS.filter((p) => !scopes.includes(p));
    const missingRecommended = META_RECOMMENDED_PERMISSIONS.filter((p) => !scopes.includes(p));
    const expiresAt = debug?.expires_at ? new Date(debug.expires_at * 1000).toISOString() : debug?.expires_at === 0 ? null : undefined;
    const noAdsAccess = scopes.length > 0 && !scopes.includes('ads_management') && !scopes.includes('ads_read');
    const status: TokenInspection['status'] = noAdsAccess ? 'PERMISSION_REVOKED' : 'ACTIVE';
    const typeRaw = (debug?.type ?? '').toUpperCase();
    const tokenType: TokenInspection['tokenType'] =
      typeRaw === 'USER' || typeRaw === 'PAGE' || typeRaw === 'APP' || typeRaw === 'SYSTEM_USER' ? (typeRaw as TokenInspection['tokenType']) : 'UNKNOWN';

    let message = 'Token is valid.';
    if (noAdsAccess) message = 'The token is valid but has neither ads_management nor ads_read permission.';
    else if (missingRequired.length && scopes.length) message = `Token is valid but missing: ${missingRequired.join(', ')}.`;

    return {
      valid: status === 'ACTIVE',
      status,
      message,
      metaUserId: me.id,
      metaUserName: me.name,
      tokenType,
      appId: debug?.app_id,
      appName: debug?.application,
      expiresAt: expiresAt ?? null,
      dataAccessExpiresAt: debug?.data_access_expires_at ? new Date(debug.data_access_expires_at * 1000).toISOString() : null,
      scopes,
      missingRequired: scopes.length ? missingRequired : [],
      missingRecommended: scopes.length ? missingRecommended : [],
      latencyMs: Date.now() - started,
    };
  }

  /** Checks that Meta is reachable through the proxy (a token-less request must return a Graph error JSON). */
  async testProxy(proxy: ProxyConfig): Promise<ProxyTestResult> {
    const started = Date.now();
    try {
      const res = await axios.get(`${this.config.meta.baseUrl}/${this.config.meta.version}/me`, {
        ...agentOptions(proxy),
        proxy: false,
        timeout: 15_000,
        validateStatus: () => true,
      });
      const latencyMs = Date.now() - started;
      if (res.status === 407) return { ok: false, message: 'The proxy rejected the credentials (HTTP 407).', latencyMs };
      const isGraph = typeof res.data === 'object' && res.data !== null && 'error' in (res.data as object);
      return isGraph
        ? { ok: true, message: `Proxy works: Meta Graph API reachable in ${latencyMs} ms.`, latencyMs }
        : { ok: false, message: `Unexpected answer through the proxy (HTTP ${res.status}).`, latencyMs };
    } catch (err) {
      return { ok: false, message: `Proxy connection failed: ${(err as Error).message}`, latencyMs: Date.now() - started };
    }
  }

  private fromError(err: unknown): TokenInspection {
    const base = { scopes: [], missingRequired: [], missingRecommended: [] };
    if (err instanceof MetaApiError) {
      if (err.category === 'AUTH') {
        return { ...base, valid: false, status: err.metaSubcode === 463 ? 'EXPIRED' : 'INVALID', message: err.details.friendlyMessage };
      }
      if (err.category === 'PERMISSION') return { ...base, valid: false, status: 'PERMISSION_REVOKED', message: err.details.friendlyMessage };
      return { ...base, valid: false, status: 'ERROR', message: err.details.friendlyMessage };
    }
    return { ...base, valid: false, status: 'ERROR', message: (err as Error).message };
  }
}
