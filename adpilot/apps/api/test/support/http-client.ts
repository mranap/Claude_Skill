/**
 * Browser-like API client for tests: keeps cookies (respecting Path and expiry), sends the Origin header and
 * the double-submit CSRF token exactly like the web app does.
 */
export interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

interface Cookie {
  value: string;
  path: string;
  expires?: number;
}

export class ApiClient {
  private readonly cookies = new Map<string, Cookie>();
  /** Set to false to simulate a request without the CSRF header. */
  sendCsrf = true;
  /** Source IP this client appears to come from (sent as X-Forwarded-For; tests run with TRUST_PROXY=1). */
  forwardedFor?: string;

  constructor(
    readonly baseUrl: string,
    readonly origin = 'http://localhost:3000',
    readonly userAgent = 'vitest-client',
  ) {}

  cookie(name: string): string | undefined {
    const c = this.cookies.get(name);
    if (!c || (c.expires !== undefined && c.expires <= Date.now())) return undefined;
    return c.value;
  }

  setCookie(name: string, value: string, path = '/'): void {
    this.cookies.set(name, { value, path });
  }

  clearCookies(): void {
    this.cookies.clear();
  }

  /** Copies the cookie jar (e.g. to replay an old refresh token). */
  snapshotCookies(): Map<string, Cookie> {
    return new Map([...this.cookies].map(([k, v]) => [k, { ...v }]));
  }

  restoreCookies(snapshot: Map<string, Cookie>): void {
    this.cookies.clear();
    for (const [k, v] of snapshot) this.cookies.set(k, { ...v });
  }

  /** Headers a browser would send, for raw requests the fetch-based helpers cannot make (e.g. aborted uploads). */
  rawHeaders(path: string): Record<string, string> {
    const csrf = this.cookie('ap_csrf');
    return { Cookie: this.cookieHeader(path), Origin: this.origin, 'User-Agent': this.userAgent, ...(csrf ? { 'X-CSRF-Token': csrf } : {}) };
  }

  private cookieHeader(path: string): string {
    const now = Date.now();
    return [...this.cookies]
      .filter(([, c]) => path.startsWith(c.path) && (c.expires === undefined || c.expires > now))
      .map(([k, c]) => `${k}=${c.value}`)
      .join('; ');
  }

  private storeCookies(headers: Headers): void {
    for (const raw of headers.getSetCookie()) {
      const [pair = '', ...attrs] = raw.split(';').map((s) => s.trim());
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = decodeURIComponent(pair.slice(eq + 1));
      const cookie: Cookie = { value, path: '/' };
      for (const attr of attrs) {
        const [k = '', v = ''] = attr.split('=');
        const key = k.toLowerCase();
        if (key === 'path') cookie.path = v;
        if (key === 'expires') cookie.expires = Date.parse(v);
        if (key === 'max-age') cookie.expires = Date.now() + Number(v) * 1000;
      }
      if (cookie.expires !== undefined && cookie.expires <= Date.now()) this.cookies.delete(name);
      else this.cookies.set(name, cookie);
    }
  }

  async request<T = any>(
    method: string,
    path: string,
    body?: unknown,
    opts: { headers?: Record<string, string>; form?: FormData; raw?: boolean } = {},
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      ...(this.forwardedFor ? { 'X-Forwarded-For': this.forwardedFor } : {}),
      ...(opts.headers ?? {}),
    };
    const cookie = this.cookieHeader(new URL(url).pathname);
    if (cookie) headers.Cookie = cookie;
    if (!['GET', 'HEAD'].includes(method)) {
      headers.Origin ??= this.origin;
      const csrf = this.cookie('ap_csrf');
      if (this.sendCsrf && csrf && !headers['X-CSRF-Token']) headers['X-CSRF-Token'] = csrf;
    }
    let payload: string | FormData | undefined;
    if (opts.form) payload = opts.form;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(url, { method, headers, body: payload, redirect: 'manual' });
    this.storeCookies(res.headers);
    const text = await res.text();
    let parsed: unknown = text;
    if (!opts.raw && (res.headers.get('content-type') ?? '').includes('application/json')) {
      parsed = text ? JSON.parse(text) : null;
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  }

  get<T = any>(path: string, headers?: Record<string, string>) {
    return this.request<T>('GET', path, undefined, { headers });
  }
  post<T = any>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>('POST', path, body ?? {}, { headers });
  }
  put<T = any>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>('PUT', path, body ?? {}, { headers });
  }
  patch<T = any>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>('PATCH', path, body ?? {}, { headers });
  }
  delete<T = any>(path: string, headers?: Record<string, string>) {
    return this.request<T>('DELETE', path, undefined, { headers });
  }

  /** Loads the CSRF cookie like the web app does on first render. */
  async init(): Promise<this> {
    await this.get('/api/auth/csrf');
    return this;
  }

  async login(email: string, password: string): Promise<ApiResponse> {
    if (!this.cookie('ap_csrf')) await this.init();
    return this.post('/api/auth/login', { email, password });
  }
}

/** Throws with the response body when the status is not the expected one (readable test failures). */
export function expectStatus<T>(res: ApiResponse<T>, status: number): ApiResponse<T> {
  if (res.status !== status) {
    throw new Error(`Expected HTTP ${status} but got ${res.status}: ${typeof res.body === 'string' ? res.body : JSON.stringify(res.body)}`);
  }
  return res;
}
