import { expect, request, type APIRequestContext, type Page } from '@playwright/test';
import { env } from './env';

/** Short unique suffix for the names a run creates. */
export function runStamp(): string {
  return Date.now().toString(36).slice(-5);
}

export async function signIn(
  page: Page,
  email = env.adminEmail,
  password = env.adminPassword,
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page, `sign in as ${email} (check the credentials)`).toHaveURL(/\/dashboard(\?|$)/, {
    timeout: 30_000,
  });
}

/** Collects uncaught exceptions of a page. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** A signed-in page, or an API session from `apiSession` (clean-up without a browser page). */
export type ApiClient = Page | APIRequestContext;

export interface ApiResult<T> {
  status: number;
  body: T;
}

/**
 * JSON request with the session cookies and CSRF token of the client. Used for set-up, look-ups and clean-up
 * only; everything under test goes through the UI.
 */
export async function api<T = unknown>(
  client: ApiClient,
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  if ('evaluate' in client) {
    return client.evaluate(
      async ({ method, path, body }) => {
        const cookie = document.cookie
          .split('; ')
          .find((c) => c.startsWith('__Host-ap_csrf=') || c.startsWith('ap_csrf='));
        const csrf = cookie ? decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)) : undefined;
        const res = await fetch(`/api${path}`, {
          method,
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        let parsed: unknown = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = text;
        }
        return { status: res.status, body: parsed };
      },
      { method, path, body },
    ) as Promise<ApiResult<T>>;
  }
  const { cookies } = await client.storageState();
  const csrf = cookies.find((c) => c.name === '__Host-ap_csrf' || c.name === 'ap_csrf')?.value;
  const res = await client.fetch(`/api${path}`, {
    method,
    data: body,
    headers: { Accept: 'application/json', ...(csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {}) },
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  return { status: res.status(), body: parsed as T };
}

/** Like `api`, but throws unless the request succeeded (a 404 counts as done for deletions). */
export async function apiOk<T = unknown>(
  client: ApiClient,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await api<T>(client, method, path, body);
  if (res.status >= 300 && !(method === 'DELETE' && res.status === 404)) {
    throw new Error(`${method} ${path}: ${res.status} ${errorMessage(res.body)}`);
  }
  return res.body;
}

/** Signs the admin in through the API, without a browser page. Dispose the context when done. */
export async function apiSession(baseURL: string): Promise<APIRequestContext> {
  const context = await request.newContext({
    baseURL,
    // the API accepts state-changing requests only from the app's origin
    extraHTTPHeaders: { Origin: new URL(baseURL).origin },
  });
  try {
    const { csrfToken } = (await (await context.get('/api/auth/csrf')).json()) as { csrfToken: string };
    const res = await context.post('/api/auth/login', {
      headers: { 'X-CSRF-Token': csrfToken },
      data: { email: env.adminEmail, password: env.adminPassword },
    });
    if (!res.ok()) throw new Error(`API sign-in failed: ${res.status()} ${await res.text()}`);
    return context;
  } catch (error) {
    await context.dispose();
    throw error;
  }
}

/** The API error message of a failed request (`{ error: { message } }`). */
export function errorMessage(body: unknown): string {
  const message = (body as { error?: { message?: string } } | null)?.error?.message;
  return message ?? JSON.stringify(body);
}

/** Waits for a toast containing the text. */
export async function expectToast(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: text }).first()).toBeVisible();
}

/** Uuid at the end of the current URL (`/templates/<id>`, `/rules/<id>`, …). */
export function idFromUrl(page: Page): string {
  const id = /\/([0-9a-f-]{36})(?:[?#]|$)/.exec(page.url())?.[1];
  if (!id) throw new Error(`No id in ${page.url()}`);
  return id;
}

/**
 * Clean-up that a spec registers while it runs and executes in `afterAll` (last first) through an API session,
 * so it also happens when a test failed half-way. A failing action is reported and does not stop the others.
 */
export class Cleanup {
  private readonly actions: { label: string; run: (client: ApiClient) => Promise<unknown> }[] = [];

  add(label: string, run: (client: ApiClient) => Promise<unknown>): void {
    this.actions.push({ label, run });
  }

  async run(): Promise<void> {
    const actions = this.actions.splice(0).reverse();
    if (!actions.length) return;
    const session = await apiSession(env.baseUrl);
    try {
      for (const action of actions) {
        await action
          .run(session)
          .catch((error: Error) => console.warn(`Clean-up "${action.label}" failed: ${error.message}`));
      }
    } finally {
      await session.dispose();
    }
  }
}
