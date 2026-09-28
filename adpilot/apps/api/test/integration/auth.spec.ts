import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, hotp } from '../../src/modules/auth/totp';
import { linkFrom } from '../support/fake-smtp';
import { TestStack } from '../support/harness';
import { ApiClient, expectStatus, type ApiResponse } from '../support/http-client';

const totpNow = (secret: string) => hotp(base32Decode(secret), Math.floor(Date.now() / 30_000));

describe('authentication & sessions', () => {
  const stack = new TestStack();
  let admin: ApiClient;

  beforeAll(async () => {
    await stack.start({ worker: true });
    await stack.configureSmtp();
    // Every test client connects from 127.0.0.1; the per-IP limit is exercised explicitly in the last test.
    await stack.setSettings('security', { loginRateLimitPerMinute: 200 });
    admin = await stack.loginSuperAdmin();
  });
  afterAll(() => stack.stop());

  it('logs in with HttpOnly cookies and returns the current user without secrets', async () => {
    const c = stack.client();
    const res = expectStatus(await c.login(stack.superAdmin.email, stack.superAdmin.password), 200);
    expect(res.body.status).toBe('OK');
    const setCookies = res.headers.getSetCookie().join('\n');
    expect(setCookies).toMatch(/ap_at=[^;]+;.*HttpOnly/i);
    expect(setCookies).toMatch(/ap_rt=[^;]+;.*Path=\/api\/auth.*HttpOnly/i);
    const me = expectStatus(await c.get('/api/auth/me'), 200).body;
    expect(me.email).toBe(stack.superAdmin.email);
    expect(me.role.key ?? me.role).toBeTruthy();
    expect(JSON.stringify(me)).not.toMatch(/passwordHash|twoFactorSecret/);
  });

  it('rejects unauthenticated access to protected endpoints', async () => {
    const res = await stack.client().get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.requestId).toBeTruthy();
  });

  it('uses one generic message for unknown e-mail and wrong password, then locks the account', async () => {
    const user = await stack.createUser(admin);
    const c = await stack.client().init();
    const unknown = await c.post('/api/auth/login', { email: 'nobody@adpilot.test', password: 'whatever123' });
    const wrong = await c.post('/api/auth/login', { email: user.email, password: 'wrong-password-1' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);

    for (let i = 0; i < 4; i++) await c.post('/api/auth/login', { email: user.email, password: `wrong-password-${i + 2}` });
    const locked = await c.post('/api/auth/login', { email: user.email, password: user.password });
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    const row = await stack.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    const audit = await stack.prisma.auditLog.findFirst({ where: { action: 'auth.account.locked', subjectUserId: user.id } });
    expect(audit).not.toBeNull();
  });

  it('blocking a user revokes the sessions and prevents login', async () => {
    const user = await stack.createUser(admin);
    expectStatus(await user.client.get('/api/auth/me'), 200);
    expectStatus(await admin.post(`/api/admin/users/${user.id}/block`, { reason: 'test' }), 200);
    expect((await user.client.get('/api/auth/me')).status).toBe(401);
    const again = await stack.client().login(user.email, user.password);
    expect(again.status).toBe(403);
    expect(again.body.error.code).toBe('ACCOUNT_BLOCKED');
    expectStatus(await admin.post(`/api/admin/users/${user.id}/unblock`, {}), 200);
    expectStatus(await stack.client().login(user.email, user.password), 200);
  });

  it('forces a temporary password to be changed before anything else', async () => {
    const email = `temp.${Date.now()}@adpilot.test`;
    expectStatus(
      await admin.post('/api/admin/users', { email, roleId: await stack.roleId('USER'), mode: 'password', password: 'Temporary123x' }),
      201,
    );
    const c = stack.client();
    expectStatus(await c.login(email, 'Temporary123x'), 200);
    const blocked = await c.get('/api/meta-profiles');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expectStatus(await c.post('/api/account/password', { currentPassword: 'Temporary123x', newPassword: 'Brandnew123x' }), 200);
    expectStatus(await c.get('/api/meta-profiles'), 200);
  });

  it('rotates refresh tokens, tolerates parallel tabs and revokes the session on late reuse', async () => {
    const user = await stack.createUser(admin);
    const c = stack.client();
    expectStatus(await c.login(user.email, user.password), 200);
    const before = c.snapshotCookies();
    const oldRefresh = c.cookie('ap_rt');
    expectStatus(await c.post('/api/auth/refresh'), 200);
    expect(c.cookie('ap_rt')).not.toBe(oldRefresh);

    // A second tab still holding the previous token within the grace window gets an access token only.
    const tab = stack.client();
    tab.restoreCookies(before);
    expectStatus(await tab.post('/api/auth/refresh'), 200);

    // After the grace window the previous token is treated as stolen: the whole session is revoked.
    const session = await stack.prisma.session.findFirstOrThrow({ where: { userId: user.id, revokedAt: null }, orderBy: { createdAt: 'desc' } });
    await stack.prisma.session.update({ where: { id: session.id }, data: { rotatedAt: new Date(Date.now() - 5 * 60_000) } });
    const thief = stack.client();
    thief.restoreCookies(before);
    expect((await thief.post('/api/auth/refresh')).status).toBe(401);
    const revoked = await stack.prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(revoked.revokedReason).toBe('refresh_token_reuse');
    // The legitimate client is signed out as well (its token belonged to the revoked session).
    expect((await c.post('/api/auth/refresh')).status).toBe(401);
  });

  it('enforces CSRF token and Origin on state-changing requests', async () => {
    const user = await stack.createUser(admin);
    user.client.sendCsrf = false;
    const noToken = await user.client.patch('/api/account/profile', { name: 'X' });
    expect(noToken.status).toBe(403);
    expect(noToken.body.error.code).toBe('CSRF_INVALID');
    user.client.sendCsrf = true;
    const badOrigin = await user.client.patch('/api/account/profile', { name: 'X' }, { Origin: 'https://evil.example' });
    expect(badOrigin.status).toBe(403);
    expectStatus(await user.client.patch('/api/account/profile', { name: 'Valid' }), 200);
  });

  it('rejects a pre-login (anonymous) CSRF token on authenticated endpoints', async () => {
    const user = await stack.createUser(admin);
    // Obtain an anonymous token from a fresh client and replay it together with the user's session cookie.
    const anon = await stack.client().init();
    const anonToken = anon.cookie('ap_csrf')!;
    user.client.setCookie('ap_csrf', anonToken);
    const res = await user.client.patch('/api/account/profile', { name: 'X' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('session probe and platform status never answer 401', async () => {
    const anon = await stack.client().get('/api/auth/session');
    expect(anon.status).toBe(200);
    expect(anon.body).toEqual({ authenticated: false, refreshable: false });
    const me = expectStatus(await admin.get('/api/auth/session'), 200).body;
    expect(me.authenticated).toBe(true);
    expect(me.user.email).toBe(stack.superAdmin.email);
    const status = expectStatus(await stack.client().get('/api/system/status'), 200).body;
    expect(status).toEqual({ maintenance: { enabled: false, message: null }, platformName: 'AdPilot' });
  });

  it('password reset links are single-use and sign out other sessions', async () => {
    const user = await stack.createUser(admin);
    const anon = await stack.client().init();
    expectStatus(await anon.post('/api/auth/password/forgot', { email: user.email }), 202);
    // Unknown e-mail: same answer, nothing sent (no account enumeration).
    expectStatus(await anon.post('/api/auth/password/forgot', { email: 'ghost@adpilot.test' }), 202);
    const mail = await stack.smtp.waitFor((m) => m.to.includes(user.email) && /reset/i.test(m.subject));
    const token = new URL(linkFrom(mail, '/reset-password')).searchParams.get('token')!;
    expect(stack.smtp.to('ghost@adpilot.test')).toHaveLength(0);

    expect(expectStatus(await anon.get(`/api/auth/password/reset/validate?token=${token}`), 200).body.valid).toBe(true);
    expectStatus(await anon.post('/api/auth/password/reset', { token, password: 'ResetPassw0rd!' }), 200);
    const reuse = await anon.post('/api/auth/password/reset', { token, password: 'AnotherPassw0rd!' });
    expect(reuse.status).toBe(400);
    expect((await user.client.get('/api/auth/me')).status).toBe(401);
    expectStatus(await stack.client().login(user.email, 'ResetPassw0rd!'), 200);
  });

  it('expired reset tokens are rejected', async () => {
    const user = await stack.createUser(admin);
    const anon = await stack.client().init();
    expectStatus(await anon.post('/api/auth/password/forgot', { email: user.email }), 202);
    const mail = await stack.smtp.waitFor((m) => m.to.includes(user.email) && /reset/i.test(m.subject));
    const token = new URL(linkFrom(mail, '/reset-password')).searchParams.get('token')!;
    await stack.prisma.passwordResetToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await anon.post('/api/auth/password/reset', { token, password: 'ResetPassw0rd!' })).status).toBe(400);
  });

  it('two-factor authentication: enable, login with TOTP, single-use recovery codes', async () => {
    const user = await stack.createUser(admin);
    const setup = expectStatus(await user.client.post('/api/account/2fa/setup'), 200).body;
    expect(setup.otpauthUrl).toContain('otpauth://totp/');
    expect((await user.client.post('/api/account/2fa/enable', { code: '000000' })).status).toBe(400);
    const { recoveryCodes } = expectStatus(await user.client.post('/api/account/2fa/enable', { code: totpNow(setup.secret) }), 200).body;
    expect(recoveryCodes).toHaveLength(10);
    const stored = await stack.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.twoFactorSecretEnc).toMatch(/^enc1:/);
    expect(stored.twoFactorSecretEnc).not.toContain(setup.secret);

    const c = stack.client();
    const step1 = expectStatus(await c.login(user.email, user.password), 200).body;
    expect(step1.status).toBe('MFA_REQUIRED');
    expect(c.cookie('ap_at')).toBeUndefined();
    expect((await c.post('/api/auth/login/2fa', { ticket: step1.ticket, code: '123456' })).status).toBe(401);
    expectStatus(await c.post('/api/auth/login/2fa', { ticket: step1.ticket, code: totpNow(setup.secret) }), 200);
    expectStatus(await c.get('/api/auth/me'), 200);

    // Recovery code works once.
    const c2 = stack.client();
    const t2 = expectStatus(await c2.login(user.email, user.password), 200).body.ticket;
    expectStatus(await c2.post('/api/auth/login/2fa', { ticket: t2, code: recoveryCodes[0] }), 200);
    const c3 = stack.client();
    const t3 = expectStatus(await c3.login(user.email, user.password), 200).body.ticket;
    expect((await c3.post('/api/auth/login/2fa', { ticket: t3, code: recoveryCodes[0] })).status).toBe(401);
  });

  it('logout revokes the session server-side', async () => {
    const user = await stack.createUser(admin);
    const snapshot = user.client.snapshotCookies();
    expectStatus(await user.client.post('/api/auth/logout'), 200);
    const replay = stack.client();
    replay.restoreCookies(snapshot);
    expect((await replay.get('/api/auth/me')).status).toBe(401);
    expect((await replay.post('/api/auth/refresh')).status).toBe(401);
  });

  it('rate limits sign-in attempts per IP with Retry-After (runs last: it exhausts the IP bucket)', async () => {
    await stack.setSettings('security', { loginRateLimitPerMinute: 3 });
    const c = await stack.client().init();
    let limited: ApiResponse | null = null;
    for (let i = 0; i < 6 && !limited; i++) {
      const res = await c.post('/api/auth/login', { email: `rl${i}@adpilot.test`, password: 'irrelevant-pass1' });
      if (res.status === 429) limited = res;
    }
    expect(limited).not.toBeNull();
    expect(limited!.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited!.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});
