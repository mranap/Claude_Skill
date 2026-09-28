import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { AppConfig } from '../../config/app-config';

/**
 * Checks that the Graph API host is reachable from the server (used by health checks and the admin
 * "Test Meta connectivity" button). A request without a token is expected to return an OAuth error JSON,
 * which proves DNS, TLS and routing work without consuming any user's rate limit.
 */
@Injectable()
export class MetaConnectivityService {
  constructor(private readonly config: AppConfig) {}

  async check(): Promise<{ ok: boolean; latencyMs: number; version: string; detail: string }> {
    const { baseUrl, version } = this.config.meta;
    const started = Date.now();
    try {
      const res = await axios.get(`${baseUrl}/${version}/me`, {
        timeout: 10_000,
        validateStatus: () => true,
      });
      const latencyMs = Date.now() - started;
      const body = res.data as { error?: { code?: number; message?: string } };
      const ok = res.status < 500 && (!!body?.error || res.status === 200);
      return { ok, latencyMs, version, detail: ok ? `Graph API reachable (HTTP ${res.status})` : `Unexpected HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, version, detail: (err as Error).message };
    }
  }
}
