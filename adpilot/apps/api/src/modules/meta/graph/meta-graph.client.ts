import { Injectable } from '@nestjs/common';
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import FormData from 'form-data';
import { createHmac } from 'node:crypto';
import { AppConfig } from '../../../config/app-config';
import { RequestContext } from '../../../common/context/request-context';
import { AppLogger } from '../../../infra/logger/logger';
import { LockService } from '../../../infra/locks/lock.service';
import { SettingsService } from '../../settings/settings.service';
import { MetaApiError, MetaNetworkError, classifyGraphError, GraphErrorBody } from './meta-errors';
import { MetaRateLimitService, RateScope } from './rate-limit.service';
import { parseUsageHeaders, ParsedUsage } from './usage-headers';
import { MetaApiLogService } from './meta-api-log.service';
import { ProxyConfig, agentFor } from './proxy-agents';

/** Everything needed to call the Graph API on behalf of one Meta profile. Never logged. */
export interface MetaConnection {
  userId: string;
  profileId: string;
  accessToken: string;
  /** App secret of the token's app, when known: enables appsecret_proof. */
  appSecret?: string | null;
  /** App id of the token (rate-limit scope); defaults to the profile id. */
  appId?: string | null;
  proxy?: ProxyConfig | null;
}

export interface GraphRequest {
  method: 'GET' | 'POST' | 'DELETE';
  /** Path relative to the version root, e.g. `/act_123/campaigns`. */
  path: string;
  params?: Record<string, unknown>;
  /** Multipart body (uploads). `access_token` is appended automatically. */
  multipart?: FormData;
  /** graph.facebook.com (default) or graph-video.facebook.com for video uploads. */
  host?: 'graph' | 'video';
  /** Logical operation name for logs/monitoring, e.g. `campaign.create`. */
  category: string;
  /** Ad account (numeric id, without act_) the call belongs to — used for rate limiting/logging. */
  metaAccountId?: string;
  businessId?: string;
  timeoutMs?: number;
  /**
   * Retry network errors / transient 5xx automatically (max 2 retries, backoff + jitter).
   * Only for idempotent calls (reads, status/budget updates). Never for object creation.
   */
  safeToRetry?: boolean;
  /** Skip the per-account concurrency slot (used by long uploads that manage their own pacing). */
  skipConcurrencySlot?: boolean;
}

export interface GraphResult<T> {
  data: T;
  usage: ParsedUsage;
  status: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toParamValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return JSON.stringify(v);
}

/** Replaces numeric ids in a path so logs group by endpoint type: /act_{id}/campaigns. */
export function pathTemplate(path: string): string {
  return path.replace(/act_\d+/g, 'act_{id}').replace(/\/\d{5,}/g, '/{id}');
}

/**
 * The only place in the application that talks to the Meta Graph API. Responsibilities:
 *  - one configured API version (META_GRAPH_API_VERSION) for every call;
 *  - per-profile proxy routing (HTTP / HTTPS / SOCKS5);
 *  - appsecret_proof when the app secret is known;
 *  - central rate-limit manager (pre-check, pacing, header tracking, back-off on throttling);
 *  - per-ad-account concurrency limit (Redis semaphore);
 *  - error classification into user-friendly messages;
 *  - technical logging without secrets.
 */
@Injectable()
export class MetaGraphClient {
  private readonly logger = new AppLogger('MetaGraph');

  constructor(
    private readonly config: AppConfig,
    private readonly rateLimits: MetaRateLimitService,
    private readonly apiLog: MetaApiLogService,
    private readonly locks: LockService,
    private readonly settings: SettingsService,
  ) {}

  get version(): string {
    return this.config.meta.version;
  }

  private baseUrl(host: 'graph' | 'video' = 'graph'): string {
    const meta = this.config.meta;
    return `${host === 'video' ? meta.videoBaseUrl : meta.baseUrl}/${meta.version}`;
  }

  private scope(conn: MetaConnection, req: GraphRequest): RateScope {
    const useCase = req.category.startsWith('insights') ? 'ads_insights' : req.metaAccountId ? 'ads_management' : 'other';
    return {
      appKey: conn.appId ?? `profile-${conn.profileId}`,
      profileId: conn.profileId,
      metaAccountId: req.metaAccountId,
      businessId: req.businessId,
      useCase,
    };
  }

  async call<T = unknown>(conn: MetaConnection, req: GraphRequest): Promise<GraphResult<T>> {
    const maxRetries = req.safeToRetry ? 2 : 0;
    let attempt = 0;
    for (;;) {
      try {
        return await this.callOnce<T>(conn, req, attempt);
      } catch (err) {
        const retryable =
          err instanceof MetaApiError &&
          attempt < maxRetries &&
          (err.category === 'TRANSIENT' || err.category === 'NETWORK');
        if (!retryable) throw err;
        attempt++;
        await sleep(Math.round(1000 * 2 ** attempt * (0.8 + Math.random() * 0.4)));
      }
    }
  }

  private async callOnce<T>(conn: MetaConnection, req: GraphRequest, retryCount: number): Promise<GraphResult<T>> {
    const scope = this.scope(conn, req);
    await this.rateLimits.beforeRequest(scope);

    let slot: string | null = null;
    const slotName = req.metaAccountId && !req.skipConcurrencySlot ? `meta-acct:${req.metaAccountId}` : null;
    if (slotName) slot = await this.acquireSlot(slotName);

    const started = Date.now();
    const url = `${this.baseUrl(req.host)}${req.path}`;
    const authParams: Record<string, string> = { access_token: conn.accessToken };
    if (conn.appSecret) {
      authParams.appsecret_proof = createHmac('sha256', conn.appSecret).update(conn.accessToken).digest('hex');
    }

    const axiosConfig: AxiosRequestConfig = {
      method: req.method,
      url,
      timeout: req.timeoutMs ?? this.config.meta.timeoutMs,
      httpsAgent: agentFor(conn.proxy),
      proxy: false,
      maxBodyLength: Infinity,
      maxContentLength: 100 * 1024 * 1024,
      validateStatus: () => true,
      headers: { 'User-Agent': 'AdPilot/1.0 (+Marketing API client)' },
    };
    if (req.multipart) {
      for (const [k, v] of Object.entries(authParams)) req.multipart.append(k, v);
      for (const [k, v] of Object.entries(req.params ?? {})) if (v !== undefined) req.multipart.append(k, toParamValue(v));
      axiosConfig.data = req.multipart;
      axiosConfig.headers = { ...axiosConfig.headers, ...req.multipart.getHeaders() };
    } else if (req.method === 'POST') {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries({ ...req.params, ...authParams })) if (v !== undefined) body.append(k, toParamValue(v));
      axiosConfig.data = body.toString();
      axiosConfig.headers = { ...axiosConfig.headers, 'Content-Type': 'application/x-www-form-urlencoded' };
    } else {
      const qs: Record<string, string> = { ...authParams };
      for (const [k, v] of Object.entries(req.params ?? {})) if (v !== undefined) qs[k] = toParamValue(v);
      axiosConfig.params = qs;
    }

    let res: AxiosResponse;
    let usage: ParsedUsage = { business: [] };
    try {
      res = await axios.request(axiosConfig);
    } catch (err) {
      const netErr = this.toNetworkError(err as AxiosError, !!conn.proxy);
      this.log(conn, req, started, retryCount, undefined, netErr, usage);
      throw netErr;
    } finally {
      if (slotName && slot) await this.locks.releaseSlot(slotName, slot).catch(() => undefined);
    }

    usage = parseUsageHeaders(res.headers as Record<string, string>);
    await this.rateLimits.afterResponse(scope, usage).catch(() => undefined);

    const body = res.data as { error?: GraphErrorBody } | undefined;
    if (res.status >= 400 || (body && typeof body === 'object' && body.error)) {
      if (res.status === 407 && conn.proxy) {
        const e = new MetaNetworkError('proxy authentication failed (HTTP 407)', false, true);
        this.log(conn, req, started, retryCount, res.status, e, usage);
        throw e;
      }
      const graphErr: GraphErrorBody = body?.error ?? { message: `HTTP ${res.status}` };
      let details = classifyGraphError(graphErr, res.status);
      if (details.category === 'RATE_LIMIT') {
        const delay = await this.rateLimits.onRateLimited(scope, new MetaApiError(details, graphErr), usage);
        details = classifyGraphError(graphErr, res.status, delay);
      }
      const e = new MetaApiError(details, graphErr);
      this.log(conn, req, started, retryCount, res.status, e, usage);
      throw e;
    }
    this.log(conn, req, started, retryCount, res.status, undefined, usage);
    return { data: res.data as T, usage, status: res.status };
  }

  /** Waits up to 60 s for a per-account concurrency slot. */
  private async acquireSlot(name: string): Promise<string> {
    const { maxConcurrentRequestsPerAccount } = await this.settings.get('meta');
    const deadline = Date.now() + 60_000;
    for (;;) {
      const id = await this.locks.acquireSlot(name, maxConcurrentRequestsPerAccount, 5 * 60_000);
      if (id) return id;
      if (Date.now() > deadline) {
        throw new MetaApiError({
          friendlyMessage: 'Too many parallel Meta requests for this ad account; the operation was postponed.',
          category: 'RATE_LIMIT',
          retryable: true,
          retryAfterMs: 30_000,
        });
      }
      await sleep(200 + Math.random() * 300);
    }
  }

  private toNetworkError(err: AxiosError, viaProxy: boolean): MetaNetworkError {
    const code = err.code ?? (err.cause as { code?: string } | undefined)?.code;
    const notSent = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ERR_SOCKS_CONNECTION_REFUSED', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(code ?? '');
    const message = /socks|proxy/i.test(err.message) ? `proxy error: ${err.message}` : err.message;
    return new MetaNetworkError(message, !notSent, viaProxy, code);
  }

  private log(conn: MetaConnection, req: GraphRequest, started: number, retryCount: number, status: number | undefined, err: MetaApiError | undefined, usage: ParsedUsage): void {
    const ctx = RequestContext.get();
    this.apiLog.record({
      userId: conn.userId,
      profileId: conn.profileId,
      metaAccountId: req.metaAccountId,
      method: req.method,
      category: req.category,
      path: pathTemplate(req.path),
      httpStatus: status,
      errorCode: err?.metaCode,
      errorSubcode: err?.metaSubcode,
      errorType: err?.details.type ?? (err ? err.category : undefined),
      errorMessage: err?.details.message,
      fbtraceId: err?.details.fbtraceId,
      durationMs: Date.now() - started,
      retryCount,
      rateLimited: err?.category === 'RATE_LIMIT',
      usage: usage.business.length || usage.adAccount || usage.app ? usage : undefined,
      jobId: ctx?.jobId,
    });
    if (err && err.category !== 'RATE_LIMIT' && err.category !== 'VALIDATION') {
      this.logger.warn('Meta API call failed', { category: req.category, path: pathTemplate(req.path), code: err.metaCode, subcode: err.metaSubcode, errCategory: err.category });
    }
  }

  // ───────────── convenience helpers ─────────────

  async get<T>(conn: MetaConnection, path: string, params: Record<string, unknown>, category: string, extra: Partial<GraphRequest> = {}): Promise<T> {
    return (await this.call<T>(conn, { method: 'GET', path, params, category, safeToRetry: true, ...extra })).data;
  }

  async post<T>(conn: MetaConnection, path: string, params: Record<string, unknown>, category: string, extra: Partial<GraphRequest> = {}): Promise<T> {
    return (await this.call<T>(conn, { method: 'POST', path, params, category, ...extra })).data;
  }

  /** Follows cursor pagination (`paging.cursors.after`) up to `maxItems`. */
  async paginate<T>(
    conn: MetaConnection,
    path: string,
    params: Record<string, unknown>,
    category: string,
    extra: Partial<GraphRequest> = {},
    maxItems = 10_000,
  ): Promise<T[]> {
    const out: T[] = [];
    let after: string | undefined;
    for (let page = 0; page < 1000; page++) {
      const res = await this.get<{ data: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(
        conn,
        path,
        { limit: 200, ...params, ...(after ? { after } : {}) },
        category,
        extra,
      );
      out.push(...(res.data ?? []));
      after = res.paging?.cursors?.after;
      if (!res.paging?.next || !after || out.length >= maxItems) break;
    }
    return out.slice(0, maxItems);
  }

  /** Reads up to 50 objects in one request (`GET /?ids=a,b,c&fields=...`). */
  async getMany<T>(conn: MetaConnection, ids: string[], fields: string, category: string, extra: Partial<GraphRequest> = {}): Promise<Record<string, T>> {
    const out: Record<string, T> = {};
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      Object.assign(out, await this.get<Record<string, T>>(conn, '/', { ids: chunk.join(','), fields }, category, extra));
    }
    return out;
  }
}
