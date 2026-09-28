/**
 * End-to-end acceptance scenario (the 28 steps of the product specification), executed against the real
 * API/worker/scheduler with PostgreSQL + Redis and test doubles for Meta, S3, SMTP, Telegram and a proxy.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { LAUNCH_JOB_TERMINAL_STATUSES } from '@adpilot/shared';
import { AccountStatusTask } from '../../src/scheduler/tasks/meta.tasks';
import { StatisticsSyncTask } from '../../src/scheduler/tasks/statistics.tasks';
import { AutoRulesTask } from '../../src/scheduler/tasks/rules.tasks';
import { FakeProxy } from '../support/fake-proxy';
import { linkFrom } from '../support/fake-smtp';
import { TestStack } from '../support/harness';
import { ApiClient, expectStatus } from '../support/http-client';
import { generateMedia, uploadCreative } from '../support/media';

describe('full platform scenario (28 steps)', () => {
  const stack = new TestStack();
  const proxy = new FakeProxy();
  const chatId = 424242;
  const email = `buyer.${Date.now()}@adpilot.test`;
  const password = 'Buyer-Passw0rd-2026';
  let admin: ApiClient;
  let user: ApiClient;
  let userId: string;
  let world: ReturnType<TestStack['meta']['seed']>;
  let profileId: string;
  let adAccountId: string;
  let metaAccountId: string;
  let videoId: string;
  let templateId: string;
  let launchId: string;
  let launchCode: string;
  let ruleId: string;

  beforeAll(async () => {
    await stack.start({ worker: true, scheduler: true });
    await proxy.start();
    proxy.credentials = { username: 'buyer', password: 'proxy-secret' };
    await stack.configureSmtp();
    await stack.configureTelegram();
    // The test proxy listens on 127.0.0.1; production keeps private proxy addresses blocked (SSRF protection).
    await stack.setSettings('meta', { allowPrivateProxyAddresses: true });
    await stack.setSettings('security', { loginRateLimitPerMinute: 200 });
    world = stack.meta.seed();
    metaAccountId = world.accountIds[0]!;
    stack.meta.videoPollsUntilReady = 2;
  });
  afterAll(async () => {
    await proxy.stop();
    await stack.stop();
  });

  it('1. Super Admin creates a user (invitation)', async () => {
    admin = await stack.loginSuperAdmin();
    const res = expectStatus(await admin.post('/api/admin/users', { email, name: 'Media Buyer', roleId: await stack.roleId('USER'), mode: 'invite', timezone: 'Europe/Warsaw' }), 201);
    userId = res.body.id;
    expect(res.body.status).toBe('ACTIVE');
  });

  it('2. The user gets access through the one-time invitation link', async () => {
    const mail = await stack.smtp.waitFor((m) => m.to.includes(email));
    const token = new URL(linkFrom(mail, '/reset-password')).searchParams.get('token')!;
    const anon = await stack.client().init();
    expect(expectStatus(await anon.get(`/api/auth/password/reset/validate?token=${token}`), 200).body).toMatchObject({ valid: true, purpose: 'INVITE' });
    expectStatus(await anon.post('/api/auth/password/reset', { token, password }), 200);
    expect((await anon.post('/api/auth/password/reset', { token, password: 'Another-Passw0rd-1' })).status).toBe(400);
  });

  it('3. The user signs in', async () => {
    user = stack.client();
    const res = expectStatus(await user.login(email, password), 200);
    expect(res.body.user.email).toBe(email);
  });

  it('4. The user links Telegram', async () => {
    const link = expectStatus(await user.post('/api/notifications/telegram/link'), 200).body;
    const code = new URL(link.url).searchParams.get('start');
    const res = await fetch(`${stack.baseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'tg-webhook-secret-for-tests' },
      body: JSON.stringify({ update_id: 1, message: { message_id: 1, text: `/start ${code}`, chat: { id: chatId, type: 'private' }, from: { id: chatId, is_bot: false, username: 'buyer' } } }),
    });
    expect(res.status).toBe(200);
    expect(expectStatus(await user.get('/api/notifications/telegram'), 200).body.connected).toBe(true);
  });

  it('5. The user adds a Meta profile (token stored encrypted, masked in the UI)', async () => {
    const res = expectStatus(await user.post('/api/meta-profiles', { name: 'Main Business Manager', accessToken: world.token }), 201).body;
    profileId = res.profile.id;
    expect(res.profile.tokenMask).not.toContain(world.token.slice(4, 20));
    expect(res.inspection.valid).toBe(true);
  });

  it('6. The user adds a proxy to the profile', async () => {
    const res = expectStatus(
      await user.patch(`/api/meta-profiles/${profileId}`, { proxy: { type: 'HTTP', host: '127.0.0.1', port: proxy.port, username: 'buyer', password: 'proxy-secret' } }),
      200,
    ).body;
    expect(res.profile.proxy).toMatchObject({ type: 'HTTP', host: '127.0.0.1', port: proxy.port });
    expect(JSON.stringify(res)).not.toContain('proxy-secret');
  });

  /** Every Meta request since `since` reached the emulator through the proxy's upstream connections. */
  const viaProxyOnly = (since: number) => {
    const reqs = stack.meta.requests.filter((r) => r.at >= since);
    expect(reqs.length).toBeGreaterThan(0);
    expect(reqs.filter((r) => !proxy.upstreamPorts.has(r.remotePort ?? -1)).map((r) => `${r.method} ${r.path}`)).toEqual([]);
  };
  let proxySince = 0;

  it('7. The proxy is tested (traffic really goes through it, with its credentials)', async () => {
    proxySince = Date.now();
    const res = expectStatus(await user.post(`/api/meta-profiles/${profileId}/test-proxy`), 200).body;
    expect(res.ok).toBe(true);
    expect(proxy.tunnels.at(-1)).toMatchObject({ target: `127.0.0.1:${stack.meta.port}`, authorized: true });
    viaProxyOnly(proxySince);
    // Wrong proxy credentials are reported clearly.
    const wrong = expectStatus(await user.post('/api/meta-profiles/test', { proxy: { type: 'HTTP', host: '127.0.0.1', port: proxy.port, username: 'buyer', password: 'nope' } }), 200).body;
    expect(wrong.proxy.ok).toBe(false);
  });

  it('8. The token is validated through the proxy', async () => {
    const since = Date.now();
    const res = expectStatus(await user.post(`/api/meta-profiles/${profileId}/validate`), 200).body;
    expect(res).toMatchObject({ valid: true, status: 'ACTIVE' });
    expect(res.missingRequired).toEqual([]);
    viaProxyOnly(since);
  });

  it('9. Ad accounts are discovered', async () => {
    expectStatus(await user.post(`/api/meta-profiles/${profileId}/sync`), 202);
    const accounts = await stack.waitFor(async () => {
      const r = expectStatus(await user.get(`/api/ad-accounts?profileId=${profileId}&connected=all`), 200).body;
      return r.items.length === 2 ? r.items : null;
    });
    expect(accounts.map((a: { metaAccountId: string }) => a.metaAccountId).sort()).toEqual([...world.accountIds].sort());
  });

  it('10. The user selects (connects) an ad account', async () => {
    expectStatus(await user.post('/api/ad-accounts/connect', { profileId, connect: [metaAccountId] }), 200);
    adAccountId = (await stack.prisma.adAccount.findFirstOrThrow({ where: { profileId, metaAccountId } })).id;
    await stack.waitFor(async () => (await stack.prisma.pixel.count({ where: { adAccountId } })) > 0, { message: 'pixels were not imported' });
  });

  it('11. The user uploads a video creative (validated, previewed)', async () => {
    const media = generateMedia(`${process.env.TMP_DIR}/e2e-media`);
    const file = await uploadCreative(user, media.videoA, 'video/mp4');
    expect(file).toMatchObject({ status: 'READY', type: 'VIDEO' });
    videoId = file.id;
    const thumb = await user.request('GET', `/api/creatives/${videoId}/thumbnail`, undefined, { raw: true });
    expect(thumb.status).toBe(200);
  });

  it('12. The user creates a template', async () => {
    const res = expectStatus(
      await user.post('/api/templates', {
        name: 'Joint cream — leads',
        config: {
          settings: {
            objective: 'OUTCOME_LEADS',
            destination: 'WEBSITE',
            optimizationGoal: 'OFFSITE_CONVERSIONS',
            conversion: { pixelId: world.pixelId, event: 'LEAD' },
            budget: { level: 'ADSET', type: 'DAILY', amount: '30.00' },
            identity: { pageId: world.pageId },
            dsa: { beneficiary: 'Joint Care Sp. z o.o.', payor: 'Joint Care Sp. z o.o.' },
            creative: { format: 'SINGLE_VIDEO', callToAction: 'LEARN_MORE', urlParameters: 'utm_source=facebook' },
            targeting: { ageMin: 35, ageMax: 65 },
          },
        },
      }),
      201,
    ).body;
    templateId = res.id;
  });

  it('13-14. The user adds several language variants and starts the campaign creation (dry run first)', async () => {
    const draft = expectStatus(await user.post(`/api/drafts/from-template/${templateId}`), 201).body;
    const ad = (lang: string, text: string) => ({ key: `ad-${lang}`, creativeFileId: videoId, primaryText: text, headline: 'Joint relief', link: `https://example.com/${lang}` });
    const config = {
      ...draft.config,
      profileId,
      adAccountId,
      name: 'Joint cream launch',
      variants: [
        { key: 'en', label: 'English', countries: ['US', 'CA'], locales: [{ key: 6, name: 'English (US)' }], ads: [ad('en', 'Move freely again.')] },
        { key: 'pl', label: 'Polish', countries: ['PL'], locales: [{ key: 64, name: 'Polish' }], ads: [ad('pl', 'Wróć do ruchu.')] },
        { key: 'de', label: 'German', countries: ['DE', 'AT'], locales: [{ key: 5, name: 'German' }], budgetAmount: '45.50', ads: [ad('de', 'Wieder frei bewegen.')] },
      ],
    };
    expectStatus(await user.put(`/api/drafts/${draft.id}`, { name: config.name, templateId, profileId, adAccountId, config }), 200);
    const dry = expectStatus(await user.post('/api/launches/dry-run', { config }), 200).body;
    expect(dry.ok).toBe(true);
    expect(dry.summary).toMatchObject({ campaigns: 1, adSets: 3, ads: 3 });

    const idempotencyKey = `e2e-${Date.now()}`;
    const res = expectStatus(await user.post('/api/launches', { idempotencyKey, draftId: draft.id, config }), 202).body;
    launchId = res.job.id;
    launchCode = res.job.code;
    expect(res.duplicate).toBe(false);
  });

  it('15-16. The worker uploads the video to Meta and waits for processing', async () => {
    await stack.waitFor(async () => {
      const job = await stack.prisma.launchJob.findUniqueOrThrow({ where: { id: launchId } });
      await stack.promoteDelayed('campaign-launch');
      return ['CREATING_CAMPAIGN', 'CREATING_ADSETS', 'CREATING_ADS', 'VERIFYING', 'ACTIVATING', ...LAUNCH_JOB_TERMINAL_STATUSES].includes(job.status);
    }, { timeoutMs: 60_000, message: 'video was not processed' });
    expect(stack.meta.videos.size).toBe(1);
    const asset = await stack.prisma.creativeMetaAsset.findFirstOrThrow({ where: { creativeFileId: videoId, adAccountId } });
    expect(asset.metaVideoId).toBeTruthy();
    expect(asset.thumbnailUrl).toBeTruthy();
  });

  it('17-20. Campaign, ad sets and ads are created and verified (no duplicates, through the proxy)', async () => {
    const job = await stack.waitFor(async () => {
      const j = expectStatus(await user.get(`/api/launches/${launchId}`), 200).body;
      if (LAUNCH_JOB_TERMINAL_STATUSES.includes(j.status)) return j;
      await stack.promoteDelayed('campaign-launch');
      return null;
    }, { timeoutMs: 60_000, intervalMs: 250 });
    expect(job.status, JSON.stringify(job.items.filter((i: { status: string }) => i.status !== 'VERIFIED' && i.status !== 'CREATED'))).toBe('COMPLETED');
    const campaigns = stack.meta.objectsOf('campaign').filter((o) => String(o.fields.name).includes(launchCode));
    expect(campaigns).toHaveLength(1);
    const adsets = stack.meta.objectsOf('adset').filter((o) => o.fields.campaign_id === campaigns[0].id);
    const ads = stack.meta.objectsOf('ad').filter((o) => o.fields.campaign_id === campaigns[0].id);
    const diag = JSON.stringify({
      items: job.items.map((i: { kind: string; key: string; status: string; metaId: string | null }) => [i.kind, i.key, i.status, i.metaId]),
      adsets: stack.meta.objectsOf('adset').map((o) => [o.id, o.fields.campaign_id, o.fields.name, o.fields.status]),
      campaigns: stack.meta.objectsOf('campaign').map((o) => [o.id, o.fields.name]),
    });
    expect(adsets, diag).toHaveLength(3);
    expect(ads).toHaveLength(3);
    // Budgets in minor units, per language/geo group; EU ad sets carry the DSA fields.
    expect(adsets.map((s) => s.fields.daily_budget).sort()).toEqual(['3000', '3000', '4550']);
    const byLocale = (key: number) => adsets.find((s) => (s.fields.targeting as { locales?: number[] }).locales?.includes(key))!;
    expect((byLocale(5).fields.targeting as { geo_locations: { countries: string[] } }).geo_locations.countries).toEqual(['DE', 'AT']);
    // All Meta traffic of this profile (discovery, uploads, creation, verification) went through its proxy.
    viaProxyOnly(proxySince);
    // Mirrored into the platform.
    await stack.waitFor(async () => (await stack.prisma.ad.count({ where: { userId } })) === 3);
  });

  it('21. The statistics worker fetches Insights', async () => {
    const today = DateTime.now().setZone('Europe/Warsaw').toFormat('yyyy-MM-dd');
    const adsets = stack.meta.objectsOf('adset').filter((o) => String(o.fields.name).length && o.account === metaAccountId);
    for (const s of adsets) stack.meta.insightOverrides.set(`${s.id}|${today}`, { spend: '40.00', leads: 1, impressions: 4000, clicks: 80, inline_link_clicks: 60 });
    const campaign = stack.meta.objectsOf('campaign').find((o) => String(o.fields.name).includes(launchCode))!;
    stack.meta.insightOverrides.set(`${campaign.id}|${today}`, { spend: '120.00', leads: 3, impressions: 12000, clicks: 240, inline_link_clicks: 180 });
    stack.meta.insightOverrides.set(`${metaAccountId}|${today}`, { spend: '120.00', leads: 3, impressions: 12000, clicks: 240, inline_link_clicks: 180 });
    await stack.prisma.adAccount.update({ where: { id: adAccountId }, data: { nextStatsSyncAt: null } });
    await stack.runTask(StatisticsSyncTask);
    await stack.waitFor(async () => (await stack.prisma.adAccount.findUniqueOrThrow({ where: { id: adAccountId } })).statsSyncStatus === 'SUCCESS', { timeoutMs: 30_000 });
    expect(await stack.prisma.insightDaily.count({ where: { adAccountId } })).toBeGreaterThan(0);
  });

  it('22. The dashboard shows the new numbers', async () => {
    const d = expectStatus(await user.get('/api/dashboard?range=today'), 200).body;
    expect(d.cards.spend).toEqual([{ currency: 'USD', value: '120.00' }]);
    expect(d.cards.leads).toBe(3);
    expect(d.cards.cpl).toEqual([{ currency: 'USD', value: '40.00' }]);
  });

  it('23. The user creates an automated rule', async () => {
    const res = expectStatus(
      await user.post('/api/rules', {
        name: 'Pause expensive ad sets',
        targetLevel: 'ADSET',
        scope: { adAccountIds: [adAccountId] },
        conditions: [{ metric: 'cpl', operator: 'gt', value: '30' }],
        timeRange: 'TODAY',
        action: 'PAUSE',
        cooldownMinutes: 120,
        maxActionsPerDay: 2,
        checkIntervalMinutes: 60,
      }),
      201,
    ).body;
    ruleId = res.id;
  });

  it('24-25. The rule fires on schedule and the user gets one Telegram notification', async () => {
    await stack.prisma.autoRule.update({ where: { id: ruleId }, data: { nextRunAt: new Date(Date.now() - 1000) } });
    await stack.runTask(AutoRulesTask);
    await stack.waitFor(async () => (await stack.prisma.autoRuleExecution.count({ where: { ruleId, result: 'SUCCESS' } })) === 3, { timeoutMs: 30_000 });
    const campaign = stack.meta.objectsOf('campaign').find((o) => String(o.fields.name).includes(launchCode))!;
    const adsets = stack.meta.objectsOf('adset').filter((o) => o.fields.campaign_id === campaign.id);
    expect(adsets.every((s) => s.fields.status === 'PAUSED')).toBe(true);
    const msg = await stack.telegram.waitForMessage(chatId, (m) => /Pause expensive ad sets/.test(m.text));
    expect(msg.text).toMatch(/acted on 3 object/);
    // The rule's own schedule moved forward: running the scheduler again does not repeat anything.
    await stack.runTask(AutoRulesTask);
    await new Promise((r) => setTimeout(r, 1000));
    expect(await stack.prisma.autoRuleExecution.count({ where: { ruleId, result: 'SUCCESS' } })).toBe(3);
    expect(stack.telegram.sentTo(chatId).filter((m) => /Pause expensive ad sets/.test(m.text))).toHaveLength(1);
  });

  it('26-28. The ad account status changes, the checker records it and notifies exactly once', async () => {
    const acc = stack.meta.accounts.get(metaAccountId)!;
    acc.account_status = 2;
    acc.disable_reason = 3; // RISK_PAYMENT
    for (let i = 0; i < 3; i++) {
      const started = new Date();
      await stack.prisma.adAccount.update({ where: { id: adAccountId }, data: { nextStatusCheckAt: new Date(Date.now() - 1000) } });
      await stack.runTask(AccountStatusTask);
      await stack.waitFor(async () => {
        const a = await stack.prisma.adAccount.findUniqueOrThrow({ where: { id: adAccountId } });
        return a.lastStatusCheckAt && a.lastStatusCheckAt >= started;
      });
    }
    const history = await stack.prisma.accountStatusHistory.findMany({ where: { adAccountId } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromKey: 'ACTIVE', toKey: 'DISABLED', disableReason: 3 });

    await stack.telegram.waitForMessage(chatId, (m) => /Disabled/.test(m.text));
    await stack.smtp.waitFor((m) => m.to.includes(email) && /Disabled/.test(m.subject));
    await new Promise((r) => setTimeout(r, 1500));
    expect(stack.telegram.sentTo(chatId).filter((m) => /Disabled/.test(m.text))).toHaveLength(1);
    expect(stack.smtp.to(email).filter((m) => /Disabled/.test(m.subject))).toHaveLength(1);
    const inApp = expectStatus(await user.get('/api/notifications'), 200).body.items.filter((n: { type: string }) => n.type === 'AD_ACCOUNT_STATUS_CHANGED');
    expect(inApp).toHaveLength(1);
    // The dashboard surfaces the problem.
    const d = expectStatus(await user.get('/api/dashboard?range=today'), 200).body;
    expect(d.alerts.some((a: { kind: string; status: string }) => a.kind === 'AD_ACCOUNT' && a.status === 'Disabled')).toBe(true);
  });

  it('keeps an audit trail of the whole journey', async () => {
    const audit = expectStatus(await admin.get(`/api/admin/audit?subjectUserId=${userId}&pageSize=100`), 200).body.items.map((a: { action: string }) => a.action);
    for (const action of ['admin.user.created', 'auth.password.reset', 'telegram.linked', 'meta_profile.created', 'campaign.launch_requested', 'rule.created']) {
      expect(audit, action).toContain(action);
    }
  });
});
