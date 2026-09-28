import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestStack, type TestUser } from '../support/harness';
import { ApiClient, expectStatus } from '../support/http-client';

describe('Meta profiles, discovery and tenant isolation', () => {
  const stack = new TestStack();
  let admin: ApiClient;
  let alice: TestUser;
  let bob: TestUser;
  let world: ReturnType<TestStack['meta']['seed']>;
  let aliceProfileId: string;

  beforeAll(async () => {
    await stack.start({ worker: true });
    await stack.setSettings('security', { loginRateLimitPerMinute: 200 });
    admin = await stack.loginSuperAdmin();
    alice = await stack.createUser(admin);
    bob = await stack.createUser(admin);
    world = stack.meta.seed();
  });
  afterAll(() => stack.stop());

  it('validates a token before saving without storing anything', async () => {
    const res = expectStatus(await alice.client.post('/api/meta-profiles/test', { accessToken: world.token }), 200).body;
    expect(res.token.valid).toBe(true);
    expect(res.token.missingRequired ?? []).toEqual([]);
    expect(await stack.prisma.metaProfile.count()).toBe(0);
    const bad = expectStatus(await alice.client.post('/api/meta-profiles/test', { accessToken: 'EAAB-not-a-real-token-xxxxxxxx' }), 200).body;
    expect(bad.token.valid).toBe(false);
  });

  it('stores the token encrypted, returns only a mask and discovers assets in the background', async () => {
    const res = expectStatus(await alice.client.post('/api/meta-profiles', { name: 'Main BM', accessToken: world.token }), 201).body;
    aliceProfileId = res.profile.id;
    expect(res.profile.tokenMask).toMatch(/^EAAB\*+.{3}$/);
    expect(JSON.stringify(res)).not.toContain(world.token);
    expect(res.profile.status).toBe('ACTIVE');

    const row = await stack.prisma.metaProfile.findUniqueOrThrow({ where: { id: aliceProfileId } });
    expect(row.tokenEnc).toMatch(/^enc1:/);
    expect(row.tokenEnc).not.toContain(world.token);

    // Discovery job (meta-sync queue) imports businesses, ad accounts and pages.
    const accounts = await stack.waitFor(async () => {
      const r = expectStatus(await alice.client.get(`/api/ad-accounts?profileId=${aliceProfileId}&connected=all`), 200).body;
      return r.items?.length === 2 ? r.items : null;
    }, { message: 'ad accounts were not discovered' });
    expect(accounts.map((a: { metaAccountId: string }) => a.metaAccountId).sort()).toEqual([...world.accountIds].sort());
    const assets = expectStatus(await alice.client.get(`/api/meta-profiles/${aliceProfileId}/assets`), 200).body;
    expect(JSON.stringify(assets)).toContain(world.pageId);

    // Duplicate token for the same user is rejected.
    expect((await alice.client.post('/api/meta-profiles', { name: 'Dup', accessToken: world.token })).status).toBe(409);
  });

  it('refuses proxies on private/loopback addresses unless the administrator allows them (SSRF protection)', async () => {
    for (const host of ['127.0.0.1', '169.254.169.254', 'localhost', '10.0.0.5']) {
      const res = await alice.client.post('/api/meta-profiles', { name: 'Internal', accessToken: `${world.token}x`, proxy: { type: 'HTTP', host, port: 8080 } });
      expect(res.status, host).toBe(400);
      expect(res.body.error.code).toBe('PROXY_ERROR');
      const test = expectStatus(await alice.client.post('/api/meta-profiles/test', { proxy: { type: 'SOCKS5', host, port: 1080 } }), 200).body;
      expect(test.proxy.ok, host).toBe(false);
      expect(test.proxy.message).toMatch(/private or reserved/);
    }
    expect(await stack.prisma.metaProfile.count({ where: { name: 'Internal' } })).toBe(0);
  });

  it('never exposes the token in API logs', async () => {
    // Log rows are buffered and written in batches; the unsaved "test token" calls must be logged too.
    const logs = await stack.waitFor(async () => {
      const rows = await stack.prisma.metaApiLog.findMany({ take: 500 });
      return rows.some((r) => r.profileId === null) && rows.some((r) => r.profileId === aliceProfileId) ? rows : null;
    }, { message: 'Meta API calls were not logged' });
    expect(JSON.stringify(logs)).not.toContain(world.token);
    expect(logs.every((l) => !/access_token=(?!\[REDACTED\])/.test(l.path))).toBe(true);
  });

  it('connects ad accounts and enforces the minimum statistics interval', async () => {
    const res = expectStatus(await alice.client.post('/api/ad-accounts/connect', { profileId: aliceProfileId, connect: world.accountIds }), 200).body;
    expect(JSON.stringify(res)).toBeTruthy();
    const list = expectStatus(await alice.client.get('/api/ad-accounts'), 200).body.items;
    expect(list).toHaveLength(2);
    const id = list[0].id;
    const tooFrequent = await alice.client.patch(`/api/ad-accounts/${id}`, { statsSyncIntervalMinutes: 5 });
    expect(tooFrequent.status).toBe(400);
    expect(JSON.stringify(tooFrequent.body)).toMatch(/35/);
    expectStatus(await alice.client.patch(`/api/ad-accounts/${id}`, { statsSyncIntervalMinutes: 35 }), 200);
  });

  it('isolates tenants: another user cannot read or change foreign objects (no IDOR)', async () => {
    const aliceAccounts = expectStatus(await alice.client.get('/api/ad-accounts'), 200).body.items;
    const accountId = aliceAccounts[0].id;

    // Bob sees nothing of Alice's.
    expect(expectStatus(await bob.client.get('/api/meta-profiles'), 200).body).toEqual([]);
    expect(expectStatus(await bob.client.get('/api/ad-accounts'), 200).body.items).toEqual([]);

    // Direct access by id is answered with 404 (existence is not revealed).
    for (const [method, path, body] of [
      ['GET', `/api/meta-profiles/${aliceProfileId}`],
      ['PATCH', `/api/meta-profiles/${aliceProfileId}`, { name: 'hijack' }],
      ['DELETE', `/api/meta-profiles/${aliceProfileId}`],
      ['POST', `/api/meta-profiles/${aliceProfileId}/validate`, {}],
      ['POST', `/api/meta-profiles/${aliceProfileId}/sync`, {}],
      ['GET', `/api/meta-profiles/${aliceProfileId}/assets`],
      ['GET', `/api/ad-accounts/${accountId}`],
      ['PATCH', `/api/ad-accounts/${accountId}`, { statsSyncEnabled: false }],
      ['POST', `/api/ad-accounts/${accountId}/check-status`, {}],
      ['GET', `/api/ad-accounts/${accountId}/status-history`],
      ['GET', `/api/ad-accounts/${accountId}/pixels`],
    ] as [string, string, unknown?][]) {
      const res = await bob.client.request(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
    }

    // Bob cannot attach Alice's ad accounts to his own request either.
    const hijack = await bob.client.post('/api/ad-accounts/connect', { profileId: aliceProfileId, connect: world.accountIds });
    expect(hijack.status).toBe(404);

    // Statistics / launches / rules scoped by foreign ids return nothing or 404.
    const stats = await bob.client.get(`/api/statistics?adAccountId=${accountId}&range=last_7d&level=CAMPAIGN`);
    expect([403, 404]).toContain(stats.status);

    // Launch validation/creation with foreign ids: rejected without revealing anything about the objects.
    const foreignConfig = {
      profileId: aliceProfileId,
      adAccountId: accountId,
      name: 'Hijack',
      settings: {
        objective: 'OUTCOME_TRAFFIC',
        destination: 'WEBSITE',
        optimizationGoal: 'LINK_CLICKS',
        budget: { level: 'ADSET', type: 'DAILY', amount: '10' },
        identity: { pageId: world.pageId },
      },
      variants: [{ key: 'v1', label: 'US', countries: ['US'], ads: [{ key: 'a1', primaryText: 'x', link: 'https://example.com' }] }],
    };
    const validation = expectStatus(await bob.client.post('/api/launches/validate', { config: foreignConfig }), 200).body;
    expect(validation.ok).toBe(false);
    expect(JSON.stringify(validation.errors)).toMatch(/not found/i);
    expect(JSON.stringify(validation)).not.toContain(aliceAccounts[0].name);
    const launch = await bob.client.post('/api/launches', { idempotencyKey: `idor-${Date.now()}`, config: foreignConfig });
    expect(launch.status).toBe(400);
    expect(await stack.prisma.launchJob.count()).toBe(0);

    const unchanged = await stack.prisma.metaProfile.findUniqueOrThrow({ where: { id: aliceProfileId } });
    expect(unchanged.name).toBe('Main BM');
    expect(unchanged.deletedAt).toBeNull();
  });

  it('RBAC: regular users cannot reach the admin API, admins cannot manage super admins', async () => {
    for (const path of ['/api/admin/users', '/api/admin/settings/smtp', '/api/admin/audit', '/api/admin/logs', '/api/admin/health', '/api/admin/queues']) {
      const res = await alice.client.get(path);
      expect(res.status, path).toBe(403);
    }
    const adminUser = await stack.createUser(admin, { role: 'ADMIN' });
    const superAdminRow = await stack.prisma.user.findUniqueOrThrow({ where: { email: stack.superAdmin.email } });
    expect((await adminUser.client.post(`/api/admin/users/${superAdminRow.id}/block`, {})).status).toBe(403);
    // Admins may view settings (secrets are write-only) but only Super Admins change SMTP.
    const smtpView = expectStatus(await adminUser.client.get('/api/admin/settings/smtp'), 200).body;
    expect(smtpView.password).toBeUndefined();
    const smtpChange = await adminUser.client.put('/api/admin/settings/smtp', { values: { host: 'evil.example' }, secrets: {} });
    expect(smtpChange.status).toBe(403);
    expectStatus(await adminUser.client.get('/api/admin/users'), 200);
  });

  it('marks the profile when the token is revoked and notifies the owner once', async () => {
    const tok = stack.meta.tokens.get(world.token)!;
    tok.valid = false;
    tok.invalidSubcode = 460;
    const inspection = expectStatus(await alice.client.post(`/api/meta-profiles/${aliceProfileId}/validate`, {}), 200).body;
    expect(inspection.valid).toBe(false);
    const profile = expectStatus(await alice.client.get(`/api/meta-profiles/${aliceProfileId}`), 200).body;
    expect(['INVALID', 'EXPIRED', 'PERMISSION_REVOKED']).toContain(profile.status);
    await alice.client.post(`/api/meta-profiles/${aliceProfileId}/validate`, {});
    const notifications = await stack.prisma.notification.findMany({ where: { userId: alice.id, type: { in: ['TOKEN_REVOKED', 'TOKEN_EXPIRED'] } } });
    expect(notifications).toHaveLength(1);
    tok.valid = true;
  });
});
