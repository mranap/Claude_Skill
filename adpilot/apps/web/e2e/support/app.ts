import { expect, type Page } from '@playwright/test';
import { env } from './env';

/** Short unique suffix for names created by a run. */
export function runStamp(): string {
  return Date.now().toString(36).slice(-5);
}

export async function signIn(page: Page, email = env.adminEmail, password = env.adminPassword): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
}

export interface ApiResult<T> {
  status: number;
  body: T;
}

/**
 * JSON request from the signed-in page (its session cookies and CSRF token). Used for setup, look-ups and
 * clean-up only; everything under test goes through the UI.
 */
export async function api<T = unknown>(page: Page, method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  return page.evaluate(
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

/** Waits for a toast containing the text. */
export async function expectToast(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: text }).first()).toBeVisible();
}

/** The API error message of a failed request (`{ error: { message } }`). */
export function errorMessage(body: unknown): string {
  const message = (body as { error?: { message?: string } } | null)?.error?.message;
  return message ?? JSON.stringify(body);
}
