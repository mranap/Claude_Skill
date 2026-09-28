import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { linkFrom, tokenFrom } from '../support/fake-smtp';
import { TestStack, type TestUser } from '../support/harness';
import { ApiClient, expectStatus } from '../support/http-client';

describe('Super Admin operations', () => {
  const stack = new TestStack();
  let admin: ApiClient;
  let user: TestUser;

  beforeAll(async () => {
    await stack.start({ worker: true });
    await stack.setSettings('security', { loginRateLimitPerMinute: 200 });
    admin = await stack.loginSuperAdmin();
    user = await stack.createUser(admin);
  });
  afterAll(() => stack.stop());

  it('configures SMTP (secret write-only) and sends a test e-mail; SMTP errors are shown', async () => {
    const saved = expectStatus(
      await admin.put('/api/admin/settings/smtp', {
        values: { enabled: true, host: '127.0.0.1', port: stack.smtp.port, encryption: 'NONE', username: 'mailer', fromEmail: 'noreply@adpilot.test', fromName: 'AdPilot' },
        secrets: { password: 'smtp-secret-1' },
      }),
      200,
    ).body;
    expect(saved.passwordSet).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('smtp-secret-1');
    expectStatus(await admin.post('/api/admin/settings/smtp/test', {}), 200);
    const mail = await stack.smtp.waitFor((m) => m.to.includes(stack.superAdmin.email));
    expect(mail.auth).toEqual({ user: 'mailer', pass: 'smtp-secret-1' });

    // An empty secret input keeps the stored password.
    expectStatus(await admin.put('/api/admin/settings/smtp', { values: { fromName: 'AdPilot Ops' }, secrets: { password: '' } }), 200);
    expect(expectStatus(await admin.get('/api/admin/settings/smtp'), 200).body.passwordSet).toBe(true);

    // Pointing SMTP at another server requires the password again (SMTP AUTH would send it there).
    const moved = await admin.put('/api/admin/settings/smtp', { values: { host: 'smtp.elsewhere.test' }, secrets: {} });
    expect(moved.status).toBe(400);
    expect(expectStatus(await admin.get('/api/admin/settings/smtp'), 200).body.host).toBe('127.0.0.1');

    stack.smtp.failNext(1, '550 5.7.1 Relaying denied');
    const failed = await admin.post('/api/admin/settings/smtp/test', { to: 'ops@adpilot.test' });
    expect(failed.status).toBe(400);
    expect(failed.body.error.message).toMatch(/Relaying denied/);
  });

  it('configures the Telegram bot (token validated with Telegram, username filled in)', async () => {
    const token = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ';
    stack.telegram.validTokens.add(token);
    const saved = expectStatus(await admin.put('/api/admin/settings/telegram', { values: { enabled: true, mode: 'POLLING' }, secrets: { botToken: token } }), 200).body;
    expect(saved).toMatchObject({ enabled: true, botUsername: stack.telegram.botUsername, botTokenSet: true });
    expect(JSON.stringify(saved)).not.toContain(token);
    const bad = await admin.put('/api/admin/settings/telegram', { values: {}, secrets: { botToken: '987654321:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } });
    expect(bad.status).toBe(400);
    expectStatus(await admin.post('/api/admin/settings/telegram/test'), 200);
  });

  it('broadcasts to users by e-mail, with or without the in-app notification', async () => {
    const res = expectStatus(await admin.post('/api/admin/broadcasts', { subject: 'Planned maintenance', body: 'Tonight 22:00 UTC', channels: ['EMAIL'], inApp: false, audience: 'ALL' }), 201).body;
    await stack.waitFor(async () => (await stack.prisma.broadcast.findUniqueOrThrow({ where: { id: res.id } })).status === 'SUCCESS');
    await stack.smtp.waitFor((m) => m.to.includes(user.email) && /Planned maintenance/.test(m.subject));
    expect(expectStatus(await user.client.get('/api/notifications'), 200).body.items.some((n: { title: string }) => n.title === 'Planned maintenance')).toBe(false);

    const inApp = expectStatus(await admin.post('/api/admin/broadcasts', { subject: 'New feature', body: 'Rules can now…', channels: [], inApp: true, audience: 'SELECTED', userIds: [user.id] }), 201).body;
    await stack.waitFor(async () => (await stack.prisma.broadcast.findUniqueOrThrow({ where: { id: inApp.id } })).status === 'SUCCESS');
    expect(expectStatus(await user.client.get('/api/notifications'), 200).body.items.some((n: { title: string }) => n.title === 'New feature')).toBe(true);
  });

  it('maintenance mode blocks users but not administrators, and is announced publicly', async () => {
    expectStatus(await admin.put('/api/admin/settings/maintenance', { values: { enabled: true, message: 'Upgrading the database' }, secrets: {} }), 200);
    await stack.waitFor(async () => (await user.client.get('/api/meta-profiles')).status === 503);
    const blocked = await user.client.get('/api/meta-profiles');
    expect(blocked.body.error).toMatchObject({ code: 'MAINTENANCE', message: 'Upgrading the database' });
    expectStatus(await admin.get('/api/admin/users'), 200);
    expect(expectStatus(await stack.client().get('/api/system/status'), 200).body.maintenance).toEqual({ enabled: true, message: 'Upgrading the database' });
    expectStatus(await admin.put('/api/admin/settings/maintenance', { values: { enabled: false }, secrets: {} }), 200);
    await stack.waitFor(async () => (await user.client.get('/api/meta-profiles')).status === 200);
  });

  it('e-mail change requires the password and a confirmation link; the old address is warned', async () => {
    const newEmail = `changed.${Date.now()}@adpilot.test`;
    expect((await user.client.post('/api/account/email', { newEmail, password: 'wrong-password-1' })).status).toBe(400);
    expectStatus(await user.client.post('/api/account/email', { newEmail, password: user.password }), 202);
    const mail = await stack.smtp.waitFor((m) => m.to.includes(newEmail));
    const token = tokenFrom(linkFrom(mail, '/confirm-email'));
    const anon = await stack.client().init();
    expectStatus(await anon.post('/api/auth/email/confirm', { token }), 200);
    expect((await anon.post('/api/auth/email/confirm', { token })).status).toBe(400);
    await stack.smtp.waitFor((m) => m.to.includes(user.email) && m.to.length === 1 && !m.to.includes(newEmail) && /e-mail/i.test(m.subject + m.text));
    // The sign-in identity changed: every session ends and the user signs in with the new address.
    expect((await user.client.get('/api/auth/me')).status).toBe(401);
    user.client = stack.client();
    expectStatus(await user.client.login(newEmail, user.password), 200);
    user.email = newEmail;
  });

  it('password reset by an administrator sends a one-time link and signs the user out', async () => {
    expectStatus(await user.client.get('/api/auth/me'), 200);
    expectStatus(await admin.post(`/api/admin/users/${user.id}/reset-password`, { mode: 'link' }), 200);
    expect((await user.client.get('/api/auth/me')).status).toBe(401);
    const mail = await stack.smtp.waitFor((m) => m.to.includes(user.email) && /reset/i.test(m.subject));
    const token = tokenFrom(linkFrom(mail, '/reset-password'));
    const anon = await stack.client().init();
    expectStatus(await anon.post('/api/auth/password/reset', { token, password: 'AdminReset-2026' }), 200);
    user.client = stack.client();
    expectStatus(await user.client.login(user.email, 'AdminReset-2026'), 200);
    user.password = 'AdminReset-2026';
  });

  it('administrators cannot reset their own credentials through the admin API', async () => {
    const self = await stack.prisma.user.findUniqueOrThrow({ where: { email: stack.superAdmin.email } });
    expect((await admin.post(`/api/admin/users/${self.id}/reset-password`, { mode: 'password', password: 'Another-Passw0rd-9' })).status).toBe(403);
    expect((await admin.post(`/api/admin/users/${self.id}/reset-2fa`)).status).toBe(403);
  });

  it('role management cannot grant administrative power beyond a Super Admin decision', async () => {
    const managerRole = expectStatus(
      await admin.post('/api/admin/roles', { key: 'ROLE_MANAGER', name: 'Role manager', permissions: ['admin.roles.manage', 'admin.users.view', 'app.statistics.view'] }),
      201,
    ).body as { id: string };
    const manager = await stack.createUser(admin, { role: 'ROLE_MANAGER' });
    const roles = expectStatus(await manager.client.get('/api/admin/roles'), 200).body as { id: string; key: string }[];
    const roleOf = (key: string) => roles.find((r) => r.key === key)!.id;

    // No administrative permission can be granted, on a new role, the ADMIN role or the manager's own role.
    expect((await manager.client.post('/api/admin/roles', { key: 'SNEAKY', name: 'Sneaky', permissions: ['admin.smtp.manage'] })).status).toBe(403);
    expect((await manager.client.patch(`/api/admin/roles/${roleOf('ADMIN')}`, { name: 'Admins' })).status).toBe(403);
    expect((await manager.client.patch(`/api/admin/roles/${managerRole.id}`, { permissions: ['admin.roles.manage', 'admin.smtp.manage'] })).status).toBe(403);
    expect((await manager.client.patch(`/api/admin/roles/${roleOf('USER')}`, { permissions: ['app.statistics.view', 'admin.backups.manage'] })).status).toBe(403);
    // Product roles stay manageable.
    expectStatus(await manager.client.post('/api/admin/roles', { key: 'ANALYST', name: 'Analyst', permissions: ['app.statistics.view'] }), 201);
  });

  it('keeps an append-only audit trail', async () => {
    const audit = expectStatus(await admin.get('/api/admin/audit?action=admin.settings&pageSize=50'), 200).body;
    expect(audit.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit.items)).not.toContain('smtp-secret-1');
    const row = await stack.prisma.auditLog.findFirstOrThrow();
    await expect(stack.prisma.auditLog.update({ where: { id: row.id }, data: { action: 'tampered' } })).rejects.toThrow();
    await expect(stack.prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
    await expect(stack.prisma.auditLog.deleteMany({})).rejects.toThrow();

    // Only the retention job removes rows, and only those older than the configured period.
    const old = await stack.prisma.auditLog.create({ data: { action: 'test.old', createdAt: new Date(Date.now() - 400 * 86400_000) } });
    expectStatus(await admin.post('/api/admin/maintenance/retention'), 202);
    await stack.waitFor(async () => !(await stack.prisma.auditLog.findUnique({ where: { id: old.id } })));
    expect(await stack.prisma.auditLog.findUnique({ where: { id: row.id } })).not.toBeNull();
  });

  it('runs a database backup into the backup bucket', async () => {
    const { id } = expectStatus(await admin.post('/api/admin/backups'), 202).body;
    const backup = await stack.waitFor(async () => {
      const b = await stack.prisma.backup.findUniqueOrThrow({ where: { id } });
      return b.status === 'SUCCESS' || b.status === 'FAILED' ? b : null;
    }, { timeoutMs: 60_000 });
    expect(backup.status, backup.error ?? '').toBe('SUCCESS');
    const object = stack.s3.buckets.get(process.env.S3_BACKUP_BUCKET!)!.get(backup.storageKey!);
    expect(object?.body.subarray(0, 5).toString()).toBe('PGDMP'); // pg_dump custom format
    expect(object!.body.toString('latin1')).not.toContain('smtp-secret-1'); // secrets are encrypted in the dump
  });

  it('shows queues and workers for monitoring', async () => {
    const queues = expectStatus(await admin.get('/api/admin/queues'), 200).body;
    expect(JSON.stringify(queues)).toContain('campaign-launch');
    const workers = expectStatus(await admin.get('/api/admin/workers'), 200).body;
    expect(JSON.stringify(workers)).toContain('campaign-launch');
    expectStatus(await admin.get('/api/admin/health'), 200);
  });
});
