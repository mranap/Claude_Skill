import type { Page } from '@playwright/test';
import { Cleanup, api, apiOk, errorMessage, expectToast, runStamp, signIn, watchErrors } from './support/app';
import { env, missingEnv } from './support/env';
import { mailsTo, waitForLink } from './support/mail';
import { expect, test } from './support/test';

/**
 * One-time e-mail links: the token travels in the URL fragment (`#token=…`), the page validates it with a POST,
 * removes it from the address bar and never sends it in a URL. E-mails are read from the fake-smtp output.
 */
const missing = missingEnv('admin', 'mail');
const stamp = runStamp();
const invitee = `e2e-invite-${stamp}@example.com`;
const passwords = { invite: `Invite-${stamp}-Passw0rd!`, reset: `Reset-${stamp}-Passw0rd!` };
const cleanup = new Cleanup();

interface SmtpSettings {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  encryption: string;
  fromEmail: string;
  fromName: string;
  passwordSet: boolean;
}

/** Path, query and fragment of an e-mail link, opened on the configured base URL. */
const target = (link: URL) => `${link.pathname}${link.search}${link.hash}`;

/**
 * Points Super Admin → SMTP at the mail catcher (restored afterwards). Returns why it cannot, when a stored SMTP
 * password would have to be dropped: the API only keeps it while the server stays the same.
 */
async function pointSmtpAtCatcher(page: Page): Promise<string | undefined> {
  const current = await apiOk<SmtpSettings>(page, 'GET', '/admin/settings/smtp');
  const wanted = { enabled: true, host: env.smtpHost, port: env.smtpPort, username: '', encryption: 'NONE' };
  const keys = Object.keys(wanted) as (keyof typeof wanted)[];
  if (keys.every((key) => current[key] === wanted[key])) return undefined;
  const res = await api(page, 'PUT', '/admin/settings/smtp', {
    values: { ...wanted, fromEmail: current.fromEmail || 'no-reply@example.com' },
    secrets: {},
  });
  if (res.status >= 400 && errorMessage(res.body).includes('password again')) {
    return `The SMTP settings keep a password for ${current.host}. Point Super Admin → SMTP at ${env.smtpHost}:${env.smtpPort} (encryption None) to run this spec.`;
  }
  expect(res.status, errorMessage(res.body)).toBe(200);
  const { passwordSet: _passwordSet, ...original } = current;
  cleanup.add('restore the SMTP settings', (admin) =>
    apiOk(admin, 'PUT', '/admin/settings/smtp', { values: original, secrets: {} }),
  );
  return undefined;
}

test.describe.serial('e-mail links with the token in the fragment', () => {
  test.skip(!!missing, missing);

  test.afterAll(() => cleanup.run());

  test('invitation link: set a password, sign in, the used link is refused', async ({
    page,
    browser,
    baseURL,
  }) => {
    await signIn(page);

    const blocked = await pointSmtpAtCatcher(page);
    test.skip(!!blocked, blocked);

    await test.step('invite a user from the admin UI', async () => {
      cleanup.add('delete the invited user', async (admin) => {
        const users = await apiOk<{ items: { id: string; email: string }[] }>(
          admin,
          'GET',
          `/admin/users?q=${encodeURIComponent(invitee)}`,
        );
        for (const user of users.items) {
          if (user.email === invitee) await apiOk(admin, 'DELETE', `/admin/users/${user.id}`);
        }
      });
      await page.goto('/admin/users');
      await page.getByRole('button', { name: 'Create user' }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Email').fill(invitee);
      await dialog.getByLabel('Full name').fill(`E2E invitee ${stamp}`);
      await dialog.getByRole('button', { name: 'Create and send invite' }).click();
      await expectToast(page, 'User created');
    });

    const link = await test.step('the invitation e-mail carries the token in the fragment', async () => {
      const url = await waitForLink(invitee, '/reset-password');
      expect(url.hash).toMatch(/^#token=[\w-]{20,}$/);
      expect(url.searchParams.has('token'), 'token in the query string').toBe(false);
      return url;
    });

    const context = await browser.newContext({ baseURL });
    try {
      const guest = await context.newPage();
      const errors = watchErrors(guest);
      const apiCalls: string[] = [];
      guest.on('request', (r) => {
        if (new URL(r.url()).pathname.startsWith('/api/')) apiCalls.push(`${r.method()} ${r.url()}`);
      });

      await test.step('the link opens "Set your password" and leaves no token in the address bar', async () => {
        await guest.goto(target(link));
        await expect(guest.getByRole('heading', { name: 'Set your password' })).toBeVisible();
        await expect(guest.getByLabel('Password', { exact: true })).toBeVisible();
        expect(guest.url()).not.toContain('token');
        expect(
          apiCalls.filter((c) => c.startsWith('POST ') && c.includes('/api/auth/password/reset/validate')),
        ).toHaveLength(1);
        expect(
          apiCalls.filter((c) => c.includes('token=')),
          'API requests with the token in the URL',
        ).toEqual([]);
      });

      await test.step('set the password and sign in', async () => {
        await guest.getByLabel('Password', { exact: true }).fill(passwords.invite);
        await guest.getByLabel('Confirm password').fill(passwords.invite);
        await guest.getByRole('button', { name: 'Set password' }).click();
        await expect(guest.getByRole('heading', { name: 'Your password is set' })).toBeVisible();
        await guest.getByRole('link', { name: 'Continue to sign in' }).click();
        await expect(guest).toHaveURL(/\/login/);
        await signIn(guest, invitee, passwords.invite);
      });

      await test.step('the used link is refused', async () => {
        await guest.goto(target(link));
        await expect(
          guest.getByRole('heading', { name: 'This link is invalid or has expired' }),
        ).toBeVisible();
        expect(guest.url()).not.toContain('token');
      });

      expect(errors, 'uncaught exceptions in the page').toEqual([]);
    } finally {
      await context.close();
    }
  });

  test('password reset link: new password, sign in', async ({ page }) => {
    const seen = mailsTo(invitee).length;
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill(invitee);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();

    const link = await waitForLink(invitee, '/reset-password', seen);
    expect(link.hash).toMatch(/^#token=[\w-]{20,}$/);
    await page.goto(target(link));
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    await expect(page).not.toHaveURL(/token/);
    await page.getByLabel('New password', { exact: true }).fill(passwords.reset);
    await page.getByLabel('Confirm password').fill(passwords.reset);
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible();
    await signIn(page, invitee, passwords.reset);
  });

  test('e-mail confirmation link with an unknown token shows the invalid state', async ({ page }) => {
    await page.goto(`/confirm-email#token=${'x'.repeat(40)}`);
    await expect(page.getByRole('heading', { name: /invalid or has expired/ })).toBeVisible();
    await expect(page).not.toHaveURL(/token/);
  });
});
