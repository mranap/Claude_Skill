/**
 * TEST DOUBLE — in-memory emulator of the Meta Graph / Marketing API used ONLY by the automated tests
 * (unit/integration/e2e). It is never part of the application build or of production images.
 *
 * It implements the endpoints the platform uses with realistic behaviour (Graph error format, cursor
 * pagination, usage headers, required-field validation, asynchronous video processing, insights rows) and
 * supports fault injection: throttling, token revocation, delays and "processed but response lost" to prove
 * idempotency/reconciliation logic.
 */
import busboy from 'busboy';
import { createHash, createHmac, randomInt } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';

export interface EmuToken {
  token: string;
  userId: string;
  userName: string;
  appId: string;
  appSecret?: string;
  type: 'USER' | 'SYSTEM_USER';
  scopes: string[];
  expiresAt: number; // unix seconds, 0 = never
  valid: boolean;
  invalidSubcode?: number;
  businesses: string[];
  adAccounts: string[]; // numeric ids
  pages: string[];
}

export interface EmuAccount {
  account_id: string;
  name: string;
  currency: string;
  timezone_name: string;
  timezone_offset_hours_utc: number;
  account_status: number;
  disable_reason: number;
  amount_spent: string;
  balance: string;
  spend_cap: string;
  min_daily_budget: number;
  business?: { id: string; name: string };
  default_dsa_payor?: string;
  default_dsa_beneficiary?: string;
}

interface Obj {
  id: string;
  type: 'campaign' | 'adset' | 'ad' | 'creative';
  account: string;
  created_time: string;
  updated_time: string;
  fields: Record<string, unknown>;
}

interface Video {
  id: string;
  account: string;
  size: number;
  received: number;
  finished: boolean;
  pollsUntilReady: number;
  error?: string;
}

export interface Fault {
  /** Matches "METHOD /path" (path without version prefix). */
  match: RegExp;
  times: number;
  /**
   * error: Graph error response; drop-after-process: the object is created but the answer is lost;
   * drop-before-process: the connection breaks after the request was sent, nothing is created; delay: slow answer.
   */
  kind: 'error' | 'drop-after-process' | 'drop-before-process' | 'delay';
  status?: number;
  error?: Record<string, unknown>;
  headers?: Record<string, string>;
  delayMs?: number;
}

export interface InsightOverride {
  spend?: string;
  impressions?: number;
  reach?: number;
  clicks?: number;
  inline_link_clicks?: number;
  leads?: number;
  purchases?: number;
  purchase_value?: string;
}

const PAGE_SIZE_DEFAULT = 25;
let seq = 100_000_000_000_000;
// Strictly increasing with random gaps: ids look like Meta's and can never collide.
const nextId = () => String((seq += 1 + randomInt(1000)));
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, '+0000');

export class MetaEmulator {
  readonly version = 'v26.0';
  private server!: http.Server;
  port = 0;
  readonly tokens = new Map<string, EmuToken>();
  readonly accounts = new Map<string, EmuAccount>();
  readonly businesses = new Map<string, { id: string; name: string; verification_status: string; owned: string[]; client: string[]; pages: string[] }>();
  readonly pages = new Map<string, { id: string; name: string; category: string; ig?: { id: string; username: string } }>();
  readonly pixels = new Map<string, { id: string; name: string; accounts: string[] }>();
  readonly audiences = new Map<string, { id: string; name: string; subtype: string; account: string }>();
  readonly objects = new Map<string, Obj>();
  readonly images = new Map<string, { hash: string; account: string; url: string }>();
  readonly videos = new Map<string, Video>();
  readonly insightOverrides = new Map<string, InsightOverride>(); // key `${objectId}|${date}`
  readonly faults: Fault[] = [];
  readonly requests: { method: string; path: string; params: Record<string, unknown>; remotePort?: number; at: number }[] = [];
  usageHeaders: Record<string, string> = {};
  /** When true, every response carries a high usage header (to test pacing). */
  videoPollsUntilReady = 2;

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(port = 0): Promise<void> {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(port, '127.0.0.1', () => r()));
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  reset(): void {
    this.tokens.clear();
    this.accounts.clear();
    this.businesses.clear();
    this.pages.clear();
    this.pixels.clear();
    this.audiences.clear();
    this.objects.clear();
    this.images.clear();
    this.videos.clear();
    this.insightOverrides.clear();
    this.faults.length = 0;
    this.requests.length = 0;
    this.usageHeaders = {};
  }

  /** Default world: one token with 1 business, 2 ad accounts (USD, PLN), 1 page with IG, 1 pixel. */
  seed(opts: { token?: string; appSecret?: string } = {}): { token: string; accountIds: string[]; pageId: string; pixelId: string; businessId: string } {
    const token = opts.token ?? `EAAB${createHash('sha256').update(String(Math.random())).digest('hex').slice(0, 60)}`;
    const businessId = nextId();
    const acc1 = String(1000000000 + randomInt(1e8));
    const acc2 = String(2000000000 + randomInt(1e8));
    const pageId = nextId();
    const pixelId = nextId();
    this.accounts.set(acc1, {
      account_id: acc1,
      name: 'Joint EU USD',
      currency: 'USD',
      timezone_name: 'Europe/Warsaw',
      timezone_offset_hours_utc: 2,
      account_status: 1,
      disable_reason: 0,
      amount_spent: '123456',
      balance: '0',
      spend_cap: '0',
      min_daily_budget: 100,
      business: { id: businessId, name: 'Test Business' },
    });
    this.accounts.set(acc2, {
      account_id: acc2,
      name: 'Joint PL PLN',
      currency: 'PLN',
      timezone_name: 'Europe/Warsaw',
      timezone_offset_hours_utc: 2,
      account_status: 1,
      disable_reason: 0,
      amount_spent: '5000',
      balance: '0',
      spend_cap: '0',
      min_daily_budget: 500,
    });
    this.businesses.set(businessId, { id: businessId, name: 'Test Business', verification_status: 'verified', owned: [acc1], client: [], pages: [pageId] });
    this.pages.set(pageId, { id: pageId, name: 'Joint Care', category: 'Health/beauty', ig: { id: nextId(), username: 'jointcare' } });
    this.pixels.set(pixelId, { id: pixelId, name: 'Main pixel', accounts: [acc1, acc2] });
    this.tokens.set(token, {
      token,
      userId: nextId(),
      userName: 'Test Media Buyer',
      appId: '123456789012345',
      appSecret: opts.appSecret,
      type: 'SYSTEM_USER',
      scopes: ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement'],
      expiresAt: 0,
      valid: true,
      businesses: [businessId],
      adAccounts: [acc1, acc2],
      pages: [pageId],
    });
    return { token, accountIds: [acc1, acc2], pageId, pixelId, businessId };
  }

  inject(fault: Fault): void {
    this.faults.push(fault);
  }

  /** Creates an object as if it had been made in Ads Manager (outside the platform). */
  createObject(type: Obj['type'], account: string, fields: Record<string, unknown>): Obj {
    return this.store(type, account, fields);
  }

  objectsOf(type: Obj['type']): Obj[] {
    return [...this.objects.values()].filter((o) => o.type === type);
  }

  // ───────────────────────── HTTP handling ─────────────────────────

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const prefix = `/${this.version}`;
      if (!url.pathname.startsWith(prefix)) return this.send(res, 400, this.err(2635, 'Unsupported API version', 'OAuthException'));
      const path = url.pathname.slice(prefix.length) || '/';
      const params: Record<string, unknown> = Object.fromEntries(url.searchParams.entries());
      const method = req.method ?? 'GET';
      const files: Record<string, Buffer> = {};
      if (method === 'POST') Object.assign(params, await this.readBody(req, files));
      this.requests.push({ method, path, params: { ...params, access_token: undefined }, remotePort: req.socket.remotePort, at: Date.now() });

      const fault = this.takeFault(`${method} ${path}`);
      if (fault?.kind === 'delay') await new Promise((r) => setTimeout(r, fault.delayMs ?? 1000));
      if (fault?.kind === 'drop-before-process') {
        req.socket.destroy();
        return;
      }
      if (fault?.kind === 'error') {
        for (const [k, v] of Object.entries(fault.headers ?? {})) res.setHeader(k, v);
        return this.send(res, fault.status ?? 400, { error: fault.error });
      }

      const token = this.auth(params);
      if ('error' in token) return this.send(res, 400, token);
      const result = await this.route(method, path, params, files, token.tok);
      if (fault?.kind === 'drop-after-process') {
        // The object was created but the client never receives the answer (timeout / connection reset).
        req.socket.destroy();
        return;
      }
      for (const [k, v] of Object.entries(this.usageHeaders)) res.setHeader(k, v);
      if (result.status >= 400) return this.send(res, result.status, result.body);
      return this.send(res, 200, result.body);
    } catch (err) {
      return this.send(res, 500, this.err(1, `Emulator failure: ${(err as Error).message}`, 'OAuthException', true));
    }
  }

  private takeFault(key: string): Fault | undefined {
    const f = this.faults.find((x) => x.times > 0 && x.match.test(key));
    if (f) f.times--;
    return f;
  }

  private send(res: ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  }

  err(code: number, message: string, type = 'OAuthException', transient = false, subcode?: number, userMsg?: string) {
    return {
      error: {
        message,
        type,
        code,
        ...(subcode ? { error_subcode: subcode } : {}),
        ...(userMsg ? { error_user_title: 'Invalid parameter', error_user_msg: userMsg } : {}),
        is_transient: transient,
        fbtrace_id: `A${randomInt(1e9)}`,
      },
    };
  }

  private auth(params: Record<string, unknown>): { tok: EmuToken } | { error: unknown } {
    const raw = params.access_token as string | undefined;
    if (!raw) return this.err(2500, 'An active access token must be used to query information about the current user.');
    const tok = this.tokens.get(raw);
    if (!tok) return this.err(190, 'Invalid OAuth access token - Cannot parse access token', 'OAuthException');
    if (!tok.valid) return this.err(190, 'Error validating access token: The session has been invalidated', 'OAuthException', false, tok.invalidSubcode ?? 460);
    if (tok.expiresAt && tok.expiresAt < Date.now() / 1000) return this.err(190, 'Error validating access token: Session has expired', 'OAuthException', false, 463);
    if (tok.appSecret) {
      const proof = createHmac('sha256', tok.appSecret).update(raw).digest('hex');
      if (params.appsecret_proof !== proof) return this.err(100, 'Invalid appsecret_proof provided in the API argument', 'GraphMethodException');
    }
    return { tok };
  }

  private readBody(req: IncomingMessage, files: Record<string, Buffer>): Promise<Record<string, unknown>> {
    const type = req.headers['content-type'] ?? '';
    return new Promise((resolve, reject) => {
      if (type.startsWith('multipart/form-data')) {
        const out: Record<string, unknown> = {};
        const bb = busboy({ headers: req.headers });
        bb.on('field', (name, val) => (out[name] = val));
        bb.on('file', (name, stream) => {
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => (files[name] = Buffer.concat(chunks)));
        });
        bb.on('close', () => resolve(out));
        bb.on('error', reject);
        req.pipe(bb);
      } else {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()).entries())));
        req.on('error', reject);
      }
    });
  }

  private json<T>(v: unknown): T {
    if (typeof v !== 'string') return v as T;
    try {
      return JSON.parse(v) as T;
    } catch {
      return v as unknown as T;
    }
  }

  private page<T>(items: T[], params: Record<string, unknown>) {
    const limit = Math.min(Number(params.limit ?? PAGE_SIZE_DEFAULT) || PAGE_SIZE_DEFAULT, 500);
    const offset = params.after ? Number(Buffer.from(String(params.after), 'base64').toString()) : 0;
    const slice = items.slice(offset, offset + limit);
    const nextOffset = offset + limit;
    const hasNext = nextOffset < items.length;
    return {
      data: slice,
      paging: {
        cursors: { before: Buffer.from(String(offset)).toString('base64'), after: Buffer.from(String(nextOffset)).toString('base64') },
        ...(hasNext ? { next: 'https://graph.example/next' } : {}),
      },
    };
  }

  private accountView(a: EmuAccount) {
    return { id: `act_${a.account_id}`, ...a };
  }

  private hasAccount(tok: EmuToken, act: string) {
    return tok.adAccounts.includes(act);
  }

  // ───────────────────────── routing ─────────────────────────

  private async route(method: string, path: string, p: Record<string, unknown>, files: Record<string, Buffer>, tok: EmuToken): Promise<{ status: number; body: unknown }> {
    const ok = (body: unknown) => ({ status: 200, body });
    const bad = (code: number, msg: string, subcode?: number, userMsg?: string) => ({ status: 400, body: this.err(code, msg, code === 100 ? 'OAuthException' : 'OAuthException', false, subcode, userMsg) });
    const seg = path.split('/').filter(Boolean);

    if (method === 'GET' && path === '/me') return ok({ id: tok.userId, name: tok.userName });
    if (method === 'GET' && path === '/me/permissions') return ok({ data: tok.scopes.map((s) => ({ permission: s, status: 'granted' })) });
    if (method === 'GET' && path === '/debug_token') {
      return ok({ data: { app_id: tok.appId, type: tok.type, application: 'Test App', expires_at: tok.expiresAt, data_access_expires_at: 0, is_valid: true, scopes: tok.scopes, user_id: tok.userId } });
    }
    if (method === 'GET' && path === '/me/businesses') {
      if (!tok.scopes.includes('business_management')) return bad(200, '(#200) Requires business_management permission to manage the object');
      return ok(this.page(tok.businesses.map((id) => this.businesses.get(id)).filter(Boolean).map((b) => ({ id: b!.id, name: b!.name, verification_status: b!.verification_status })), p));
    }
    if (method === 'GET' && path === '/me/adaccounts') return ok(this.page(tok.adAccounts.map((id) => this.accountView(this.accounts.get(id)!)), p));
    if (method === 'GET' && path === '/me/accounts') {
      return ok(this.page(tok.pages.map((id) => this.pages.get(id)!).map((pg) => ({ id: pg.id, name: pg.name, category: pg.category, ...(pg.ig ? { instagram_business_account: pg.ig } : {}) })), p));
    }
    if (method === 'GET' && seg.length === 2 && this.businesses.has(seg[0])) {
      const b = this.businesses.get(seg[0])!;
      if (seg[1] === 'owned_ad_accounts') return ok(this.page(b.owned.map((id) => this.accountView(this.accounts.get(id)!)), p));
      if (seg[1] === 'client_ad_accounts') return ok(this.page(b.client.map((id) => this.accountView(this.accounts.get(id)!)), p));
      if (seg[1] === 'owned_pages') return ok(this.page(b.pages.map((id) => this.pages.get(id)!).map((pg) => ({ id: pg.id, name: pg.name, category: pg.category })), p));
      if (seg[1] === 'client_pages') return ok(this.page([], p));
    }
    if (method === 'GET' && path === '/' && p.ids) {
      const out: Record<string, unknown> = {};
      for (const id of String(p.ids).split(',')) {
        const acc = this.accounts.get(id.replace(/^act_/, ''));
        if (!acc || !this.hasAccount(tok, acc.account_id)) return bad(100, `(#100) Unsupported get request. Object with ID '${id}' does not exist`, 33);
        out[id] = this.accountView(acc);
      }
      return ok(out);
    }

    // Ad account scoped endpoints
    if (seg[0]?.startsWith('act_')) {
      const act = seg[0].slice(4);
      const acc = this.accounts.get(act);
      if (!acc || !this.hasAccount(tok, act)) return bad(100, `(#100) Object with ID 'act_${act}' does not exist, cannot be loaded due to missing permissions`, 33);
      if (seg.length === 1 && method === 'GET') return ok(this.accountView(acc));
      const edge = seg[1];
      if (method === 'GET' && edge === 'adspixels') return ok(this.page([...this.pixels.values()].filter((px) => px.accounts.includes(act)).map((px) => ({ id: px.id, name: px.name, is_unavailable: false })), p));
      if (method === 'GET' && edge === 'customaudiences') return ok(this.page([...this.audiences.values()].filter((a) => a.account === act).map((a) => ({ id: a.id, name: a.name, subtype: a.subtype })), p));
      if (method === 'GET' && edge === 'promote_pages') return ok(this.page(tok.pages.map((id) => this.pages.get(id)!).map((pg) => ({ id: pg.id, name: pg.name })), p));
      if (edge === 'adimages' && method === 'POST') return ok(this.uploadImage(act, p, files));
      if (edge === 'advideos' && method === 'POST') return this.videoUpload(act, p, files);
      if (edge === 'insights' && method === 'GET') return ok(this.insights(act, null, p));
      if (method === 'POST' && edge === 'campaigns') return this.createCampaign(act, p);
      if (method === 'POST' && edge === 'adsets') return this.createAdSet(act, p);
      if (method === 'POST' && edge === 'adcreatives') return this.createCreative(act, p);
      if (method === 'POST' && edge === 'ads') return this.createAd(act, p);
      if (method === 'GET' && ['campaigns', 'adsets', 'ads', 'adcreatives'].includes(edge)) {
        const type = ({ campaigns: 'campaign', adsets: 'adset', ads: 'ad', adcreatives: 'creative' } as const)[edge as 'campaigns'];
        return ok(this.page(this.filterList(this.objectsOf(type).filter((o) => o.account === act), p), p));
      }
    }

    // Object scoped endpoints (campaign / adset / ad / video)
    const id = seg[0];
    if (id && this.videos.has(id)) {
      const v = this.videos.get(id)!;
      if (seg[1] === 'thumbnails') return ok({ data: [{ id: `${id}_t1`, uri: `https://scontent.example/v/${id}.jpg`, is_preferred: true }] });
      if (!v.finished) return ok({ id, status: { video_status: 'processing', uploading_phase: { status: 'in_progress' } } });
      if (v.error) return ok({ id, status: { video_status: 'error', uploading_phase: { status: 'complete' }, processing_phase: { status: 'error', errors: [{ code: 1, message: v.error }] } } });
      if (v.pollsUntilReady > 0) {
        v.pollsUntilReady--;
        return ok({ id, status: { video_status: 'processing', processing_progress: 50, uploading_phase: { status: 'complete' } } });
      }
      return ok({ id, status: { video_status: 'ready', processing_progress: 100, uploading_phase: { status: 'complete' } } });
    }
    if (id && this.objects.has(id)) {
      const o = this.objects.get(id)!;
      if (!this.hasAccount(tok, o.account)) return bad(10, '(#10) Application does not have permission for this action');
      if (seg.length === 1 && method === 'GET') return ok(this.view(o));
      if (seg.length === 1 && method === 'POST') return this.updateObject(o, p);
      if (seg[1] === 'insights' && method === 'GET') return ok(this.insights(o.account, o, p));
      if (method === 'GET' && (seg[1] === 'adsets' || seg[1] === 'ads')) {
        const type = seg[1] === 'adsets' ? 'adset' : 'ad';
        const key = o.type === 'campaign' ? 'campaign_id' : 'adset_id';
        return ok(this.page(this.filterList(this.objectsOf(type).filter((x) => x.fields[key] === id), p), p));
      }
    }
    return bad(100, `(#100) Unknown path components: ${path}`);
  }

  private filterList(list: Obj[], p: Record<string, unknown>): Record<string, unknown>[] {
    let out = list.filter((o) => o.fields.status !== 'DELETED');
    const filtering = this.json<{ field: string; operator: string; value: unknown }[] | undefined>(p.filtering);
    for (const f of filtering ?? []) {
      if (f.field === 'name' && f.operator === 'CONTAIN') out = out.filter((o) => String(o.fields.name ?? '').includes(String(f.value)));
    }
    const eff = this.json<string[] | undefined>(p.effective_status);
    if (Array.isArray(eff)) out = out.filter((o) => eff.includes(String(o.fields.effective_status ?? o.fields.status)));
    return out.map((o) => this.view(o));
  }

  private view(o: Obj): Record<string, unknown> {
    return { id: o.id, created_time: o.created_time, updated_time: o.updated_time, ...o.fields, effective_status: o.fields.effective_status ?? o.fields.status };
  }

  private store(type: Obj['type'], account: string, fields: Record<string, unknown>): Obj {
    const o: Obj = { id: nextId(), type, account, created_time: now(), updated_time: now(), fields };
    this.objects.set(o.id, o);
    return o;
  }

  // ───────────────────────── creation with validation ─────────────────────────

  private createCampaign(act: string, p: Record<string, unknown>) {
    const bad = (msg: string, userMsg?: string) => ({ status: 400, body: this.err(100, msg, 'OAuthException', false, 1885833, userMsg) });
    if (!p.name) return bad('(#100) The parameter name is required');
    const objectives = ['OUTCOME_LEADS', 'OUTCOME_SALES', 'OUTCOME_TRAFFIC', 'OUTCOME_AWARENESS', 'OUTCOME_ENGAGEMENT', 'OUTCOME_APP_PROMOTION'];
    if (!objectives.includes(String(p.objective))) return bad('(#100) Param objective must be one of {OUTCOME_...}');
    if (p.special_ad_categories === undefined) return bad('(#100) The parameter special_ad_categories is required');
    const cbo = p.daily_budget !== undefined || p.lifetime_budget !== undefined;
    if (!cbo && p.is_adset_budget_sharing_enabled === undefined) {
      return bad('(#100) is_adset_budget_sharing_enabled must be set when the campaign does not use a campaign budget', 'Must specify True or False in is_adset_budget_sharing_enabled field');
    }
    const o = this.store('campaign', act, {
      name: p.name,
      objective: p.objective,
      status: p.status ?? 'ACTIVE',
      special_ad_categories: this.json(p.special_ad_categories),
      daily_budget: p.daily_budget,
      lifetime_budget: p.lifetime_budget,
      bid_strategy: p.bid_strategy,
      buying_type: 'AUCTION',
      is_adset_budget_sharing_enabled: p.is_adset_budget_sharing_enabled === 'true',
    });
    return { status: 200, body: { id: o.id } };
  }

  private createAdSet(act: string, p: Record<string, unknown>) {
    const bad = (msg: string, sub?: number, userMsg?: string) => ({ status: 400, body: this.err(100, msg, 'OAuthException', false, sub, userMsg) });
    const campaign = this.objects.get(String(p.campaign_id));
    if (!campaign || campaign.type !== 'campaign' || campaign.account !== act) return bad('(#100) Invalid campaign_id', 1487101);
    for (const f of ['name', 'billing_event', 'optimization_goal', 'targeting']) if (!p[f]) return bad(`(#100) The parameter ${f} is required`);
    const targeting = this.json<Record<string, unknown>>(p.targeting);
    const countries = (targeting.geo_locations as { countries?: string[] } | undefined)?.countries ?? [];
    if (!countries.length) return bad('(#100) Targeting spec must include geo_locations', 1487756, 'You must choose a location to target.');
    const automation = targeting.targeting_automation as { advantage_audience?: number } | undefined;
    if (!automation || automation.advantage_audience === undefined) {
      return bad('(#100) Advantage audience flag is required', 1870227, 'To create your ad set, you need to enable or disable the Advantage+ audience feature.');
    }
    if (automation.advantage_audience === 1) {
      const ageMin = Number(targeting.age_min ?? 18);
      const ageMax = Number(targeting.age_max ?? 65);
      if (ageMin > 25 || ageMax < 65) {
        return bad('(#100) Invalid age for Advantage+ audience', 1870189, 'You can add a lower maximum age as a suggestion instead when creating or editing an ad set.');
      }
    }
    const cbo = campaign.fields.daily_budget !== undefined || campaign.fields.lifetime_budget !== undefined;
    if (!cbo && !p.daily_budget && !p.lifetime_budget) return bad('(#100) A budget is required when the campaign has no campaign budget', 1487838);
    if (cbo && (p.daily_budget || p.lifetime_budget)) return bad('(#100) Ad set budget cannot be set on a campaign with a campaign budget', 1885621);
    const budget = Number(p.daily_budget ?? 0);
    const min = this.accounts.get(act)!.min_daily_budget;
    if (p.daily_budget && budget < min) return bad('(#100) Budget is too low', 1885272, `Your budget must be at least ${min / 100}`);
    if (p.optimization_goal === 'OFFSITE_CONVERSIONS') {
      const po = this.json<Record<string, unknown> | undefined>(p.promoted_object);
      if (!po?.pixel_id || !po.custom_event_type) return bad('(#100) promoted_object[pixel_id] and custom_event_type are required for this optimization goal', 1885014, 'Select a pixel and conversion event.');
    }
    const eu = ['PL', 'HU', 'DE', 'FR', 'IT', 'ES', 'CZ', 'SK', 'RO', 'NL', 'BE', 'AT'];
    if (countries.some((c) => eu.includes(c)) && (!p.dsa_beneficiary || !p.dsa_payor)) {
      return bad('(#100) dsa_beneficiary and dsa_payor are required for ads targeting the EU', 3858081, 'Enter the beneficiary and payer for ads in the EU.');
    }
    const o = this.store('adset', act, {
      name: p.name,
      campaign_id: campaign.id,
      status: p.status ?? 'ACTIVE',
      daily_budget: p.daily_budget,
      lifetime_budget: p.lifetime_budget,
      billing_event: p.billing_event,
      optimization_goal: p.optimization_goal,
      destination_type: p.destination_type,
      targeting,
      promoted_object: this.json(p.promoted_object),
      bid_strategy: p.bid_strategy,
    });
    return { status: 200, body: { id: o.id } };
  }

  private createCreative(act: string, p: Record<string, unknown>) {
    const bad = (msg: string, sub?: number) => ({ status: 400, body: this.err(100, msg, 'OAuthException', false, sub) });
    const spec = this.json<Record<string, Record<string, unknown>>>(p.object_story_spec);
    if (!spec?.page_id) return bad('(#100) object_story_spec[page_id] is required');
    if (!this.pages.has(String(spec.page_id))) return bad('(#100) Invalid page_id', 1487390);
    const video = spec.video_data as Record<string, unknown> | undefined;
    const link = spec.link_data as Record<string, unknown> | undefined;
    if (video) {
      const v = this.videos.get(String(video.video_id));
      if (!v || v.account !== act) return bad('(#100) Invalid video_id', 1885252);
      if (!v.finished || v.pollsUntilReady > 0) return bad('(#100) The video is still being processed', 1885252);
      if (!video.image_url && !video.image_hash) return bad('(#100) video_data requires image_url or image_hash', 1443226);
    } else if (link) {
      const hashes = [link.image_hash, ...((link.child_attachments as { image_hash?: string }[] | undefined) ?? []).map((c) => c.image_hash)].filter(Boolean);
      for (const h of hashes) if (!this.images.has(String(h))) return bad('(#100) Invalid image hash', 1487242);
    } else {
      return bad('(#100) object_story_spec must contain link_data or video_data');
    }
    const o = this.store('creative', act, { name: p.name, object_story_spec: spec, url_tags: p.url_tags, status: 'ACTIVE' });
    return { status: 200, body: { id: o.id } };
  }

  private createAd(act: string, p: Record<string, unknown>) {
    const bad = (msg: string, sub?: number) => ({ status: 400, body: this.err(100, msg, 'OAuthException', false, sub) });
    const adset = this.objects.get(String(p.adset_id));
    if (!adset || adset.type !== 'adset' || adset.account !== act) return bad('(#100) Invalid adset_id', 1487101);
    const creative = this.json<{ creative_id?: string }>(p.creative);
    const cr = this.objects.get(String(creative?.creative_id));
    if (!cr || cr.type !== 'creative') return bad('(#100) Invalid creative', 1815299);
    const o = this.store('ad', act, {
      name: p.name,
      adset_id: adset.id,
      campaign_id: adset.fields.campaign_id,
      status: p.status ?? 'ACTIVE',
      effective_status: 'PENDING_REVIEW',
      creative: { id: cr.id },
    });
    return { status: 200, body: { id: o.id } };
  }

  private updateObject(o: Obj, p: Record<string, unknown>) {
    if (p.status) {
      if (!['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED'].includes(String(p.status))) return { status: 400, body: this.err(100, '(#100) Invalid status') };
      o.fields.status = p.status;
      o.fields.effective_status = p.status;
    }
    for (const f of ['daily_budget', 'lifetime_budget', 'name', 'bid_amount']) if (p[f] !== undefined) o.fields[f] = p[f];
    o.updated_time = now();
    return { status: 200, body: { success: true } };
  }

  // ───────────────────────── media ─────────────────────────

  private uploadImage(act: string, p: Record<string, unknown>, files: Record<string, Buffer>) {
    const images: Record<string, { hash: string; url: string }> = {};
    for (const [name, buf] of Object.entries(files)) {
      const hash = createHash('md5').update(buf).digest('hex');
      const url = `https://scontent.example/i/${hash}.jpg`;
      this.images.set(hash, { hash, account: act, url });
      images[name] = { hash, url };
    }
    if (p.bytes) {
      const buf = Buffer.from(String(p.bytes), 'base64');
      const hash = createHash('md5').update(buf).digest('hex');
      this.images.set(hash, { hash, account: act, url: `https://scontent.example/i/${hash}.jpg` });
      images.bytes = { hash, url: `https://scontent.example/i/${hash}.jpg` };
    }
    return { images };
  }

  private videoUpload(act: string, p: Record<string, unknown>, files: Record<string, Buffer>) {
    const phase = String(p.upload_phase ?? '');
    if (phase === 'start') {
      const size = Number(p.file_size);
      const v: Video = { id: nextId(), account: act, size, received: 0, finished: false, pollsUntilReady: this.videoPollsUntilReady };
      this.videos.set(v.id, v);
      return { status: 200, body: { video_id: v.id, upload_session_id: v.id, start_offset: '0', end_offset: String(Math.min(size, 1024 * 1024)) } };
    }
    const v = this.videos.get(String(p.upload_session_id));
    if (!v) return { status: 400, body: this.err(100, 'Invalid upload session', 'OAuthException', false, 1363030) };
    if (phase === 'transfer') {
      const chunk = files.video_file_chunk ?? Buffer.alloc(0);
      if (Number(p.start_offset) !== v.received) {
        return { status: 400, body: { error: { ...this.err(6000, 'Wrong offset', 'OAuthException', false, 1363037).error, error_data: { start_offset: String(v.received), end_offset: String(Math.min(v.size, v.received + 1024 * 1024)) } } } };
      }
      v.received += chunk.length;
      return { status: 200, body: { start_offset: String(v.received), end_offset: String(Math.min(v.size, v.received + 1024 * 1024)) } };
    }
    if (phase === 'finish') {
      if (v.received < v.size) return { status: 400, body: this.err(6001, 'Upload incomplete', 'OAuthException', false, 1363019) };
      v.finished = true;
      return { status: 200, body: { success: true } };
    }
    return { status: 400, body: this.err(100, 'Invalid upload_phase') };
  }

  // ───────────────────────── insights ─────────────────────────

  private insights(act: string, target: Obj | null, p: Record<string, unknown>) {
    const level = String(p.level ?? (target ? target.type : 'account'));
    const range = this.json<{ since: string; until: string } | undefined>(p.time_range);
    const dates: string[] = [];
    if (range) {
      for (let d = new Date(`${range.since}T00:00:00Z`); d <= new Date(`${range.until}T00:00:00Z`); d = new Date(d.getTime() + 86400_000)) dates.push(d.toISOString().slice(0, 10));
    } else {
      dates.push(new Date().toISOString().slice(0, 10));
    }
    const acc = this.accounts.get(act)!;
    let objects: { id: string; campaign_id?: string; adset_id?: string; name: string }[];
    if (level === 'account') objects = [{ id: act, name: acc.name }];
    else {
      const type = level === 'campaign' ? 'campaign' : level === 'adset' ? 'adset' : 'ad';
      objects = this.objectsOf(type)
        .filter((o) => o.account === act)
        .filter((o) => !target || o.id === target.id || o.fields.campaign_id === target.id || o.fields.adset_id === target.id)
        .map((o) => ({ id: o.id, name: String(o.fields.name), campaign_id: type === 'campaign' ? o.id : String(o.fields.campaign_id ?? ''), adset_id: type === 'adset' ? o.id : String(o.fields.adset_id ?? '') }));
    }
    const rows: Record<string, unknown>[] = [];
    for (const o of objects) {
      for (const date of dates) {
        const ov = this.insightOverrides.get(`${o.id}|${date}`);
        const h = parseInt(createHash('md5').update(`${o.id}|${date}`).digest('hex').slice(0, 8), 16);
        const spend = ov?.spend ?? ((h % 5000) / 100).toFixed(2);
        const impressions = ov?.impressions ?? 500 + (h % 5000);
        const clicks = ov?.clicks ?? Math.round(impressions * 0.02);
        const linkClicks = ov?.inline_link_clicks ?? Math.round(clicks * 0.8);
        const leads = ov?.leads ?? h % 7;
        const purchases = ov?.purchases ?? h % 3;
        const adset = level === 'adset' ? this.objects.get(o.id) : level === 'ad' ? this.objects.get(o.adset_id ?? '') : undefined;
        const campaign = level === 'account' ? undefined : this.objects.get(o.campaign_id ?? '');
        const goal = adset?.fields.optimization_goal as string | undefined;
        const event = (adset?.fields.promoted_object as { custom_event_type?: string } | undefined)?.custom_event_type;
        const fields = String(p.fields ?? '').split(',');
        const resultIndicator =
          goal === 'OFFSITE_CONVERSIONS' && event === 'LEAD' ? 'actions:offsite_conversion.fb_pixel_lead'
          : goal === 'OFFSITE_CONVERSIONS' && event === 'PURCHASE' ? 'actions:offsite_conversion.fb_pixel_purchase'
          : goal === 'OFFSITE_CONVERSIONS' && event ? `actions:offsite_conversion.fb_pixel_${event.toLowerCase()}`
          : goal === 'LINK_CLICKS' ? 'actions:link_click'
          : goal === 'LEAD_GENERATION' ? 'actions:onsite_conversion.lead_grouped'
          : undefined;
        const resultValue = resultIndicator?.includes('lead') ? leads : resultIndicator?.includes('purchase') ? purchases : resultIndicator === 'actions:link_click' ? linkClicks : h % 5;
        rows.push({
          account_id: act,
          account_currency: acc.currency,
          ...(campaign && fields.includes('objective') ? { objective: campaign.fields.objective } : {}),
          ...(goal && fields.includes('optimization_goal') ? { optimization_goal: goal } : {}),
          ...(resultIndicator && fields.includes('results') ? { results: [{ indicator: resultIndicator, values: [{ value: String(resultValue), attribution_windows: ['default'] }] }] } : {}),
          ...(level !== 'account' ? { campaign_id: o.campaign_id, campaign_name: this.objects.get(o.campaign_id ?? '')?.fields.name } : {}),
          ...(level === 'adset' || level === 'ad' ? { adset_id: o.adset_id, adset_name: this.objects.get(o.adset_id ?? '')?.fields.name } : {}),
          ...(level === 'ad' ? { ad_id: o.id, ad_name: o.name } : {}),
          date_start: date,
          date_stop: date,
          spend,
          impressions: String(impressions),
          reach: String(ov?.reach ?? Math.round(impressions * 0.8)),
          clicks: String(clicks),
          inline_link_clicks: String(linkClicks),
          actions: [
            ...(leads ? [{ action_type: 'lead', value: String(leads) }, { action_type: 'offsite_conversion.fb_pixel_lead', value: String(leads) }] : []),
            ...(purchases ? [{ action_type: 'purchase', value: String(purchases) }, { action_type: 'omni_purchase', value: String(purchases) }] : []),
            { action_type: 'link_click', value: String(linkClicks) },
            { action_type: 'landing_page_view', value: String(Math.round(linkClicks * 0.7)) },
          ],
          action_values: purchases ? [{ action_type: 'omni_purchase', value: ov?.purchase_value ?? (purchases * 49.99).toFixed(2) }] : [],
        });
      }
    }
    return this.page(rows, p);
  }
}

// DEVELOPMENT/TEST ONLY: `node --experimental-strip-types test/support/meta-emulator.ts [port]` runs the emulator
// standalone for manual UI testing (start the API/worker with META_GRAPH_BASE_URL and
// META_GRAPH_VIDEO_BASE_URL pointing to it). Prints the seeded access token and object ids.
if (process.argv[1]?.endsWith('meta-emulator.ts')) {
  const emulator = new MetaEmulator();
  const world = emulator.seed();
  emulator.videoPollsUntilReady = 1;
  void emulator.start(Number(process.argv[2] ?? 4010)).then(() => {
    console.log(JSON.stringify({ baseUrl: emulator.baseUrl, ...world }, null, 2));
  });
}
