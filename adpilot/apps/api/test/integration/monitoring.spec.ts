import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { AccountStatusTask } from '../../src/scheduler/tasks/meta.tasks';
import { StatisticsSyncTask } from '../../src/scheduler/tasks/statistics.tasks';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { TestStack, type TestUser } from '../support/harness';
import { expectStatus } from '../support/http-client';

describe('account monitoring, statistics and notifications', () => {
  const stack = new TestStack();
  let user: TestUser;
  let world: ReturnType<TestStack['meta']['seed']>;
  let profileId: string;
  let accountId: string;
  let metaAccountId: string;
  const chatId = 555000111;

  beforeAll(async () => {
    await stack.start({ worker: true, scheduler: true });
    await stack.setSettings('security', { loginRateLimitPerMinute: 200 });
    await stack.configureSmtp();
    await stack.configureTelegram();
    const admin = await stack.loginSuperAdmin();
    user = await stack.createUser(admin);
    world = stack.meta.seed();
    metaAccountId = world.accountIds[0]!;
    profileId = expectStatus(
      await user.client.post('/api/meta-profiles', { name: 'Monitoring BM', accessToken: world.token }),
      201,
    ).body.profile.id;
    await stack.waitFor(async () => (await stack.prisma.adAccount.count({ where: { profileId } })) === 2);
    expectStatus(
      await user.client.post('/api/ad-accounts/connect', { profileId, connect: [metaAccountId] }),
      200,
    );
    accountId = (await stack.prisma.adAccount.findFirstOrThrow({ where: { profileId, metaAccountId } })).id;
  });
  afterAll(() => stack.stop());

  describe('Telegram linking', () => {
    it('links a chat with a one-time deep link code', async () => {
      const link = expectStatus(await user.client.post('/api/notifications/telegram/link'), 200).body;
      expect(link.url).toMatch(new RegExp(`^https://t\\.me/${stack.telegram.botUsername}\\?start=`));
      const code = new URL(link.url).searchParams.get('start')!;
      // The code is stored only as a hash.
      expect(JSON.stringify(await stack.prisma.telegramLinkCode.findMany())).not.toContain(code);

      const webhook = (update: unknown, secret = 'tg-webhook-secret-for-tests') =>
        fetch(`${stack.baseUrl}/api/telegram/webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
          body: JSON.stringify(update),
        });
      const update = (text: string, id: number) => ({
        update_id: id,
        message: {
          message_id: id,
          text,
          chat: { id: chatId, type: 'private', username: 'buyer' },
          from: { id: chatId, is_bot: false, username: 'buyer', first_name: 'Ann' },
        },
      });

      expect((await webhook(update(`/start ${code}`, 1), 'wrong-secret')).status).toBe(403);
      expect((await webhook(update(`/start ${code}`, 2))).status).toBe(200);
      const status = expectStatus(await user.client.get('/api/notifications/telegram'), 200).body;
      expect(status).toMatchObject({ connected: true, username: 'buyer' });
      await stack.telegram.waitForMessage(chatId, (m) => /linked/i.test(m.text));

      // The code is single use: a second chat cannot take over the link.
      const intruder = {
        update_id: 3,
        message: {
          message_id: 3,
          text: `/start ${code}`,
          chat: { id: 999, type: 'private' },
          from: { id: 999, is_bot: false },
        },
      };
      expect((await webhook(intruder)).status).toBe(200);
      const conn = await stack.prisma.telegramConnection.findUniqueOrThrow({ where: { userId: user.id } });
      expect(conn.chatId).toBe(String(chatId));
      await stack.telegram.waitForMessage(999, (m) => /invalid or has expired/i.test(m.text));
    });
  });

  describe('ad account status checks', () => {
    const due = () =>
      stack.prisma.adAccount.update({
        where: { id: accountId },
        data: { nextStatusCheckAt: new Date(Date.now() - 1000) },
      });
    /** Runs the scheduler task and waits until the worker has checked the account (after this call started). */
    const runCheck = async () => {
      const started = new Date();
      await due();
      await stack.runTask(AccountStatusTask);
      await stack.waitFor(
        async () => {
          const a = await stack.prisma.adAccount.findUniqueOrThrow({ where: { id: accountId } });
          return a.lastStatusCheckAt && a.lastStatusCheckAt >= started ? a : null;
        },
        { message: 'status check did not run' },
      );
      // Let the notification outbox deliver before the next assertion.
      await new Promise((r) => setTimeout(r, 300));
    };

    it('the first known status is not a change; an unchanged status stays silent', async () => {
      await runCheck();
      await runCheck();
      expect(await stack.prisma.accountStatusHistory.count({ where: { adAccountId: accountId } })).toBe(0);
      expect(
        await stack.prisma.notification.count({
          where: { userId: user.id, type: 'AD_ACCOUNT_STATUS_CHANGED' },
        }),
      ).toBe(0);
    });

    it('a real change is recorded and notified exactly once (in-app, e-mail and Telegram)', async () => {
      const acc = stack.meta.accounts.get(metaAccountId)!;
      acc.account_status = 2;
      acc.disable_reason = 1;
      await runCheck();
      await runCheck(); // still disabled → no second notification
      const history = await stack.prisma.accountStatusHistory.findMany({ where: { adAccountId: accountId } });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ fromStatus: 1, toStatus: 2, disableReason: 1 });
      const notifications = await stack.prisma.notification.findMany({
        where: { userId: user.id, type: 'AD_ACCOUNT_STATUS_CHANGED' },
      });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].title).toMatch(/Active → Disabled/);

      await stack.smtp.waitFor((m) => m.to.includes(user.email) && /Disabled/.test(m.subject));
      const tg = await stack.telegram.waitForMessage(chatId, (m) => /Disabled/.test(m.text));
      expect(tg.parseMode).toBe('HTML');
      await new Promise((r) => setTimeout(r, 1000));
      expect(stack.telegram.sentTo(chatId).filter((m) => /Disabled/.test(m.text))).toHaveLength(1);
      expect(stack.smtp.to(user.email).filter((m) => /Disabled/.test(m.subject))).toHaveLength(1);

      acc.account_status = 1;
      acc.disable_reason = 0;
      await runCheck();
      expect(
        await stack.prisma.notification.count({
          where: { userId: user.id, type: 'AD_ACCOUNT_STATUS_CHANGED' },
        }),
      ).toBe(2);
    });

    it('respects per-type channel preferences', async () => {
      expectStatus(
        await user.client.put('/api/notifications/preferences', {
          preferences: [{ type: 'AD_ACCOUNT_STATUS_CHANGED', channel: 'TELEGRAM' }],
        }),
        200,
      );
      const emailsBefore = stack.smtp.to(user.email).length;
      const acc = stack.meta.accounts.get(metaAccountId)!;
      acc.account_status = 3; // UNSETTLED
      await runCheck();
      await stack.telegram.waitForMessage(chatId, (m) => /Unsettled/i.test(m.text));
      await new Promise((r) => setTimeout(r, 1000));
      expect(stack.smtp.to(user.email).length).toBe(emailsBefore);
      acc.account_status = 1;
      await runCheck();
    });

    it('manual status checks have a backend cooldown', async () => {
      await stack.prisma.adAccount.update({
        where: { id: accountId },
        data: { lastStatusCheckAt: new Date(Date.now() - 10 * 60_000) },
      });
      expectStatus(await user.client.post(`/api/ad-accounts/${accountId}/check-status`), 202);
      const again = await user.client.post(`/api/ad-accounts/${accountId}/check-status`);
      expect(again.status).toBe(429);
      expect(Number(again.headers.get('retry-after'))).toBeGreaterThan(0);
    });
  });

  describe('Telegram delivery guarantees', () => {
    it('is retried after a 429 with retry_after, and never re-sent after an ambiguous failure', async () => {
      stack.telegram.inject({
        method: 'sendMessage',
        times: 1,
        kind: 'status',
        status: 429,
        description: 'Too Many Requests: retry after 1',
        retryAfter: 1,
      });
      const n1 = expectStatus(await user.client.post('/api/notifications/test'), 202).body;
      await stack.telegram.waitForMessage(chatId, (m) => /Test notification/.test(m.text), 20_000);
      expect(stack.telegram.sentTo(chatId).filter((m) => /Test notification/.test(m.text))).toHaveLength(1);
      expect(n1).toBeTruthy();

      // The message reaches Telegram but the HTTP answer is lost: the delivery is marked uncertain, not duplicated.
      stack.telegram.inject({ method: 'sendMessage', times: 1, kind: 'drop' });
      const before = stack.telegram.sentTo(chatId).length;
      const { notificationId } = expectStatus(await user.client.post('/api/notifications/test'), 202).body;
      const delivery = await stack.waitFor(async () =>
        stack.prisma.notificationDelivery.findFirst({
          where: { notificationId, channel: 'TELEGRAM', status: { in: ['UNCERTAIN', 'SENT', 'FAILED'] } },
        }),
      );
      await new Promise((r) => setTimeout(r, 1500));
      expect(stack.telegram.sentTo(chatId).length).toBe(before + 1);
      expect(delivery.status).toBe('UNCERTAIN');
    });

    it('a chat that blocked the bot is deactivated instead of retried forever', async () => {
      stack.telegram.inject({
        method: 'sendMessage',
        times: 1,
        kind: 'status',
        status: 403,
        description: 'Forbidden: bot was blocked by the user',
      });
      await stack.prisma.notificationPreference.deleteMany({ where: { userId: user.id } });
      await stack.api.get(NotificationsService).notify({
        userId: user.id,
        type: 'SYSTEM_MESSAGE',
        severity: 'INFO',
        title: 'Blocked test',
        body: 'x',
      });
      await stack.waitFor(
        async () =>
          !(await stack.prisma.telegramConnection.findUniqueOrThrow({ where: { userId: user.id } })).isActive,
      );
    });
  });

  describe('statistics synchronisation', () => {
    it('syncs Insights in the background and respects the minimum interval (35 min)', async () => {
      const campaign = stack.meta.createObject('campaign', metaAccountId, {
        name: 'Imported campaign',
        objective: 'OUTCOME_LEADS',
        status: 'ACTIVE',
        special_ad_categories: [],
      });
      stack.meta.createObject('adset', metaAccountId, {
        name: 'Imported ad set',
        campaign_id: campaign.id,
        status: 'ACTIVE',
        daily_budget: '5000',
        optimization_goal: 'OFFSITE_CONVERSIONS',
        promoted_object: { pixel_id: world.pixelId, custom_event_type: 'LEAD' },
        targeting: { geo_locations: { countries: ['US'] } },
      });
      const today = DateTime.now().setZone('Europe/Warsaw').toFormat('yyyy-MM-dd');
      stack.meta.insightOverrides.set(`${campaign.id}|${today}`, {
        spend: '100.50',
        impressions: 10000,
        clicks: 300,
        inline_link_clicks: 250,
        leads: 3,
      });
      stack.meta.insightOverrides.set(`${metaAccountId}|${today}`, {
        spend: '100.50',
        impressions: 10000,
        clicks: 300,
        inline_link_clicks: 250,
        leads: 3,
      });

      await stack.prisma.adAccount.update({
        where: { id: accountId },
        data: { nextStatsSyncAt: null, statsSyncIntervalMinutes: 15 },
      });
      await stack.runTask(StatisticsSyncTask);
      const account = await stack.waitFor(
        async () => {
          const a = await stack.prisma.adAccount.findUniqueOrThrow({ where: { id: accountId } });
          return a.statsSyncStatus === 'SUCCESS' ? a : null;
        },
        { timeoutMs: 30_000, message: 'statistics sync did not finish' },
      );
      // Even a stored interval below the global minimum is clamped to 35 minutes.
      expect(account.nextStatsSyncAt!.getTime() - Date.now()).toBeGreaterThan(34 * 60_000);

      const insightCalls = () => stack.meta.requests.filter((r) => r.path.endsWith('/insights')).length;
      const calls = insightCalls();
      await stack.runTask(StatisticsSyncTask);
      await new Promise((r) => setTimeout(r, 1000));
      expect(insightCalls()).toBe(calls);

      const stats = expectStatus(
        await user.client.get(`/api/statistics?adAccountId=${accountId}&range=today&level=CAMPAIGN`),
        200,
      ).body;
      const row = stats.items.find((r: { metaObjectId: string }) => r.metaObjectId === campaign.id);
      expect(row.metrics).toMatchObject({ currency: 'USD', spend: '100.50', leads: 3, cpl: '33.50' });
      expect(await stack.prisma.campaign.count({ where: { metaCampaignId: campaign.id } })).toBe(1);
    });

    it('manual refresh has a backend-enforced cooldown, also under concurrent clicks', async () => {
      const [a, b] = await Promise.all([
        user.client.post('/api/statistics/refresh', { adAccountId: accountId }),
        user.client.post('/api/statistics/refresh', { adAccountId: accountId }),
      ]);
      expect([a.status, b.status].sort()).toEqual([202, 429]);
      const limited = a.status === 429 ? a : b;
      expect(limited.body.error.code).toBe('COOLDOWN');
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
      expect((await user.client.post('/api/statistics/refresh', { adAccountId: accountId })).status).toBe(
        429,
      );
      // Statistics tell the UI when a manual refresh is allowed again, with the account's time zone.
      const sync = expectStatus(await user.client.get(`/api/statistics?adAccountId=${accountId}`), 200).body
        .sync as { adAccountId: string; nextManualRefreshAt: string; timezoneName: string }[];
      const own = sync.find((x) => x.adAccountId === accountId)!;
      expect(new Date(own.nextManualRefreshAt).getTime()).toBeGreaterThan(Date.now());
      expect(own.timezoneName).toBeTruthy();
    });
  });
});
