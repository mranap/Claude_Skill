import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { AccountStatusTask, TokenCheckTask } from '../../src/scheduler/tasks/meta.tasks';
import { MetaProfileStatusService } from '../../src/modules/meta/meta-profile-status.service';
import { MetaConnectionFactory } from '../../src/modules/meta/meta-connection.factory';
import { MetaGraphClient } from '../../src/modules/meta/graph/meta-graph.client';
import { MetaRateLimitService, MetaRateLimitedError } from '../../src/modules/meta/graph/rate-limit.service';
import {
  MetaApiError,
  classifyGraphError,
  isBudgetChangeLimit,
} from '../../src/modules/meta/graph/meta-errors';
import { EntitySyncService } from '../../src/modules/campaigns/entity-sync.service';
import { TestStack, type TestUser } from '../support/harness';
import { expectStatus } from '../support/http-client';

describe('Meta profile status, discovery sync, throttling and entity sync', () => {
  const stack = new TestStack();
  let user: TestUser;
  let world: ReturnType<TestStack['meta']['seed']>;
  let profileId: string;
  let metaAccountId: string;
  let accountId: string;

  const profile = () =>
    stack.prisma.metaProfile.findUniqueOrThrow({ where: { id: profileId }, include: { proxy: true } });
  const connection = async () => stack.api.get(MetaConnectionFactory).forProfile(await profile());
  const account = () => stack.prisma.adAccount.findUniqueOrThrow({ where: { id: accountId } });
  const tokenAlerts = () =>
    stack.prisma.notification.count({
      where: { userId: user.id, type: { in: ['TOKEN_REVOKED', 'TOKEN_EXPIRED'] } },
    });
  const graphError = (error: Record<string, unknown>) => new MetaApiError(classifyGraphError(error, 400));
  const calls = (method: string, path: string) =>
    stack.meta.requests.filter((r) => r.method === method && r.path === path).length;
  const revoked = {
    code: 190,
    error_subcode: 460,
    message: 'Error validating access token: The session has been invalidated',
    type: 'OAuthException',
  };

  /** Jobs of a queue waiting in the delayed set (a deferred job, or a retry after a failed attempt). */
  const delayedJobs = async (queueName: string): Promise<number> => {
    const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    const queue = new Queue(queueName, { connection, prefix: `${process.env.QUEUE_PREFIX}:bull` });
    try {
      return await queue.getDelayedCount();
    } finally {
      await queue.close();
      connection.disconnect();
    }
  };

  beforeAll(async () => {
    await stack.start({ worker: true, scheduler: true });
    await stack.setSettings('security', { loginRateLimitPerMinute: 200 });
    const admin = await stack.loginSuperAdmin();
    user = await stack.createUser(admin);
    world = stack.meta.seed();
    metaAccountId = world.accountIds[0]!;
    profileId = expectStatus(
      await user.client.post('/api/meta-profiles', { name: 'Status BM', accessToken: world.token }),
      201,
    ).body.profile.id;
    await stack.waitFor(async () => (await profile()).syncStatus === 'SUCCESS', {
      message: 'the initial discovery did not finish',
    });
    // Connecting starts another discovery (pixels, pages and audiences of the account): let it finish first.
    const discoveries = calls('GET', '/me/adaccounts');
    expectStatus(
      await user.client.post('/api/ad-accounts/connect', { profileId, connect: [metaAccountId] }),
      200,
    );
    await stack.waitFor(
      async () => calls('GET', '/me/adaccounts') > discoveries && (await profile()).syncStatus === 'SUCCESS',
      {
        message: 'the discovery after connecting did not finish',
      },
    );
    accountId = (await stack.prisma.adAccount.findFirstOrThrow({ where: { profileId, metaAccountId } })).id;
  });
  afterAll(() => stack.stop());

  describe('discovery sync (META_SYNC)', () => {
    const syncStatus = async () => (await profile()).syncStatus;

    it('runs a deferred sync again instead of skipping it as covered by itself', async () => {
      stack.meta.inject({
        match: /^GET \/me\/adaccounts$/,
        times: 1,
        kind: 'error',
        status: 400,
        error: {
          code: 17,
          error_subcode: 2446079,
          message: 'User request limit reached',
          type: 'OAuthException',
        },
      });
      const before = calls('GET', '/me/adaccounts');
      expectStatus(await user.client.post(`/api/meta-profiles/${profileId}/sync`, {}), 202);
      // Throttled: the job is deferred. Once the cool-down has passed, it runs again.
      await stack.waitFor(
        async () => {
          if (calls('GET', '/me/adaccounts') === before) return false;
          await stack.clearMetaRateLimits();
          return (await stack.promoteDelayed('meta-sync')) > 0;
        },
        { timeoutMs: 30_000, intervalMs: 250, message: 'the sync was not deferred' },
      );
      await stack.waitFor(async () => (await syncStatus()) === 'SUCCESS', {
        message: 'the deferred sync was skipped',
      });
      expect(calls('GET', '/me/adaccounts')).toBe(before + 2);
    });

    it('retries a sync that failed temporarily instead of skipping the retry', async () => {
      // 3 answers: the request itself and the two retries of the Graph client.
      stack.meta.inject({
        match: /^GET \/me\/adaccounts$/,
        times: 3,
        kind: 'error',
        status: 500,
        error: {
          code: 2,
          message: 'Service temporarily unavailable',
          type: 'OAuthException',
          is_transient: true,
        },
      });
      const before = calls('GET', '/me/adaccounts');
      expectStatus(await user.client.post(`/api/meta-profiles/${profileId}/sync`, {}), 202);
      // After the third failed answer the attempt fails and BullMQ schedules the retry (skip its back-off).
      await stack.waitFor(
        async () =>
          calls('GET', '/me/adaccounts') >= before + 3 && (await stack.promoteDelayed('meta-sync')) > 0,
        {
          timeoutMs: 40_000,
          intervalMs: 250,
          message: 'the failed sync was not scheduled for a retry',
        },
      );
      await stack.waitFor(async () => (await syncStatus()) === 'SUCCESS', {
        message: 'the retry was skipped',
      });
      expect(calls('GET', '/me/adaccounts')).toBe(before + 4);
    });
  });

  describe('token status', () => {
    it('an object-level permission error keeps the profile active and re-checks the token instead', async () => {
      const alerts = await tokenAlerts();
      // Last validated an hour ago, so the error pulls the next check forward.
      const lastValidatedAt = new Date(Date.now() - 3600_000);
      await stack.prisma.metaProfile.update({
        where: { id: profileId },
        data: { lastValidatedAt, nextTokenCheckAt: new Date(Date.now() + 12 * 3600_000) },
      });
      // 200/1870034 (Custom Audience terms not accepted) concerns an audience, not the token.
      stack.meta.inject({
        match: /^GET \/act_\d+\/campaigns$/,
        times: 1,
        kind: 'error',
        status: 400,
        error: {
          code: 200,
          error_subcode: 1870034,
          message: 'Custom Audience Terms Not Accepted',
          type: 'OAuthException',
        },
      });
      expectStatus(await user.client.post('/api/statistics/refresh', { adAccountId: accountId }), 202);
      const after = await stack.waitFor(
        async () => {
          const p = await profile();
          return p.status !== 'ACTIVE' || p.nextTokenCheckAt! <= new Date() ? p : null;
        },
        { message: 'the permission error was not handled' },
      );
      expect(after.status).toBe('ACTIVE');
      expect(await tokenAlerts()).toBe(alerts);

      // The check (next scheduler tick) confirms that the token still has its permissions.
      await stack.runTask(TokenCheckTask);
      const checked = await stack.waitFor(
        async () => {
          const p = await profile();
          return p.lastValidatedAt! > lastValidatedAt ? p : null;
        },
        { message: 'the token was not re-checked' },
      );
      expect(checked.status).toBe('ACTIVE');
    });

    it('re-checks PERMISSION_REVOKED profiles, so a false alarm heals without manual validation', async () => {
      // A second check within the same hour must run too (its job is not dropped as a duplicate).
      await stack.prisma.metaProfile.update({
        where: { id: profileId },
        data: { status: 'PERMISSION_REVOKED', nextTokenCheckAt: new Date(Date.now() - 1000) },
      });
      await stack.runTask(TokenCheckTask);
      await stack.waitFor(async () => (await profile()).status === 'ACTIVE', {
        message: 'the profile did not heal',
      });
    });

    it('ignores errors and inspections of a token that was replaced meanwhile', async () => {
      const status = stack.api.get(MetaProfileStatusService);
      const oldFingerprint = (await profile()).tokenFingerprint;
      // The user replaces the token (another valid token of the same system user).
      const newToken = `${world.token}r`;
      stack.meta.tokens.set(newToken, { ...stack.meta.tokens.get(world.token)!, token: newToken });
      const syncs = calls('GET', '/me/adaccounts');
      const updated = expectStatus(
        await user.client.patch(`/api/meta-profiles/${profileId}`, { accessToken: newToken }),
        200,
      ).body;
      expect(updated.profile.status).toBe('ACTIVE');
      await stack.waitFor(
        async () => calls('GET', '/me/adaccounts') > syncs && (await profile()).syncStatus === 'SUCCESS',
      );
      const current = await profile();
      expect(current.tokenFingerprint).not.toBe(oldFingerprint);
      const alerts = await tokenAlerts();

      // A job that started with the old token gets "revoked" from Meta, and a check of the old token ends late.
      await status.onApiError(profileId, graphError(revoked), oldFingerprint);
      await status.applyInspection(
        profileId,
        {
          valid: false,
          status: 'PERMISSION_REVOKED',
          message: 'no ads permission',
          appId: '999999',
          scopes: ['pages_show_list'],
          missingRequired: [],
          missingRecommended: [],
        },
        oldFingerprint,
      );
      const after = await profile();
      expect(after).toMatchObject({
        status: 'ACTIVE',
        lastValidationError: null,
        tokenAppId: current.tokenAppId,
        tokenScopes: current.tokenScopes,
      });
      expect(await tokenAlerts()).toBe(alerts);

      // The same error for the current token does change the status (and alerts once).
      await status.onApiError(profileId, graphError(revoked), current.tokenFingerprint);
      expect((await profile()).status).toBe('INVALID');
      expect(await tokenAlerts()).toBe(alerts + 1);
      expectStatus(await user.client.post(`/api/meta-profiles/${profileId}/validate`, {}), 200);
      expect((await profile()).status).toBe('ACTIVE');
    });
  });

  describe('rate limits', () => {
    afterEach(async () => {
      stack.meta.usageHeaders = {};
      await stack.clearMetaRateLimits();
    });
    const read = async (id: string) =>
      stack.api
        .get(MetaGraphClient)
        .get(await connection(), `/act_${id}`, { fields: 'name' }, 'account.read', { metaAccountId: id });

    it('enforces the Business Use Case limit that Meta reports for the ad account', async () => {
      stack.meta.usageHeaders = {
        'x-business-use-case-usage': JSON.stringify({
          [metaAccountId]: [
            {
              type: 'ads_management',
              call_count: 12,
              total_cputime: 5,
              total_time: 5,
              estimated_time_to_regain_access: 7,
            },
          ],
        }),
      };
      await read(metaAccountId);
      stack.meta.usageHeaders = {};
      const sent = calls('GET', `/act_${metaAccountId}`);
      const err = await read(metaAccountId).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MetaRateLimitedError);
      expect((err as MetaRateLimitedError).retryAfterMs).toBeGreaterThan(6 * 60_000);
      expect(calls('GET', `/act_${metaAccountId}`)).toBe(sent);
      // Other ad accounts have their own quota.
      await read(world.accountIds[1]);
    });

    it('an answer that was in flight does not lift a throttling block', async () => {
      const conn = await connection();
      stack.meta.inject({
        match: /^GET \/act_\d+$/,
        times: 1,
        kind: 'error',
        status: 400,
        error: {
          code: 17,
          error_subcode: 2446079,
          message: 'User request limit reached',
          type: 'OAuthException',
        },
      });
      await expect(read(metaAccountId)).rejects.toMatchObject({ name: 'MetaApiError' });
      // A request sent before the block answers with low usage.
      await stack.api.get(MetaRateLimitService).afterResponse(
        {
          appKey: conn.appId ?? `profile-${conn.profileId}`,
          profileId: conn.profileId,
          metaAccountId,
          useCase: 'ads_management',
        },
        { adAccount: { utilPct: 12, resetSeconds: 0 }, business: [] },
      );
      const sent = calls('GET', `/act_${metaAccountId}`);
      const blocked = await read(metaAccountId).catch((e: unknown) => e);
      expect(blocked).toBeInstanceOf(MetaRateLimitedError);
      expect((blocked as MetaRateLimitedError).details).toMatchObject({ code: 17, subcode: 2446079 });
      expect(calls('GET', `/act_${metaAccountId}`)).toBe(sent);
    });

    it('613/1487632 blocks budget changes of that ad set for an hour, not the ad account', async () => {
      const graph = stack.api.get(MetaGraphClient);
      const conn = await connection();
      const act = world.accountIds[1];
      const campaign = stack.meta.createObject('campaign', act, {
        name: 'Budget limits',
        objective: 'OUTCOME_TRAFFIC',
        status: 'ACTIVE',
        special_ad_categories: [],
      });
      const [limited, other] = ['Limited', 'Other'].map((name) =>
        stack.meta.createObject('adset', act, {
          name,
          campaign_id: campaign.id,
          status: 'ACTIVE',
          daily_budget: '5000',
        }),
      );
      const post = (id: string, params: Record<string, unknown>, category: string) =>
        graph.call(conn, {
          method: 'POST',
          path: `/${id}`,
          params,
          category,
          metaAccountId: act,
          safeToRetry: true,
        });
      stack.meta.inject({
        match: new RegExp(`^POST /${limited.id}$`),
        times: 1,
        kind: 'error',
        status: 400,
        error: {
          code: 613,
          error_subcode: 1487632,
          message:
            'You can only change your ad set budget 4 times per hour. Please wait to make more changes.',
          type: 'OAuthException',
        },
      });
      const err = (await post(limited.id, { daily_budget: '6000' }, 'adset.budget').catch(
        (e: unknown) => e,
      )) as MetaApiError;
      expect(err.category).toBe('RATE_LIMIT');
      expect(err.details.retryAfterMs).toBeGreaterThanOrEqual(60 * 60_000);

      // Further budget changes of this ad set wait without calling Meta (callers can tell this limit apart) ...
      const sent = calls('POST', `/${limited.id}`);
      const blocked = await post(limited.id, { daily_budget: '6000' }, 'adset.budget').catch(
        (e: unknown) => e,
      );
      expect(blocked).toBeInstanceOf(MetaRateLimitedError);
      expect(isBudgetChangeLimit((blocked as MetaRateLimitedError).details)).toBe(true);
      expect((blocked as MetaRateLimitedError).details.friendlyMessage).toMatch(/4 budget changes per hour/);
      expect(calls('POST', `/${limited.id}`)).toBe(sent);
      // ... while its status, the other ad sets and the rest of the ad account keep working.
      await post(limited.id, { status: 'PAUSED' }, 'adset.status');
      await post(other.id, { daily_budget: '6000' }, 'adset.budget');
      await read(act);
      expect(stack.meta.objects.get(limited.id)!.fields.status).toBe('PAUSED');
      expect(stack.meta.objects.get(other.id)!.fields.daily_budget).toBe('6000');
    });
  });

  describe('entity sync', () => {
    const campaignRow = (metaCampaignId: string) =>
      stack.prisma.campaign.findUniqueOrThrow({
        where: { adAccountId_metaCampaignId: { adAccountId: accountId, metaCampaignId } },
      });

    it('never hides or overwrites rows written while the lists were being read', async () => {
      const entities = stack.api.get(EntitySyncService);
      const conn = await connection();
      const running = stack.meta.createObject('campaign', metaAccountId, {
        name: 'Running',
        objective: 'OUTCOME_TRAFFIC',
        status: 'ACTIVE',
        special_ad_categories: [],
      });
      await entities.syncAccount(await account(), conn);
      const runningId = (await campaignRow(running.id)).id;

      // The next sync reads the ads slowly. Meanwhile a launch finishes (its campaign is written right away)
      // and the platform pauses "Running".
      stack.meta.inject({ match: /^GET \/act_\d+\/ads$/, times: 1, kind: 'delay', delayMs: 3000 });
      const listed = calls('GET', `/act_${metaAccountId}/campaigns`);
      let finished = false;
      const sync = entities.syncAccount(await account(), conn).finally(() => (finished = true));
      await stack.waitFor(() => calls('GET', `/act_${metaAccountId}/campaigns`) > listed);
      const launched = stack.meta.createObject('campaign', metaAccountId, {
        name: 'Launched meanwhile',
        objective: 'OUTCOME_TRAFFIC',
        status: 'PAUSED',
        special_ad_categories: [],
      });
      await entities.syncCampaignTree(await account(), conn, launched.id, {});
      Object.assign(running.fields, { status: 'PAUSED', effective_status: 'PAUSED' });
      await stack.prisma.campaign.update({
        where: { id: runningId },
        data: { status: 'PAUSED', effectiveStatus: 'PAUSED' },
      });
      expect(finished).toBe(false);
      await sync;

      expect((await campaignRow(launched.id)).isDeleted).toBe(false);
      expect((await campaignRow(running.id)).effectiveStatus).toBe('PAUSED');
      // The next sync sees the pause in Meta too: a pause made by the platform is not reported as "stopped".
      await entities.syncAccount(await account(), conn);
      expect(
        await stack.prisma.notification.count({ where: { userId: user.id, type: 'CAMPAIGN_STOPPED' } }),
      ).toBe(0);

      // A campaign deleted in Meta is still flagged by the next sync.
      stack.meta.objects.delete(launched.id);
      await entities.syncAccount(await account(), conn);
      expect((await campaignRow(launched.id)).isDeleted).toBe(true);
    });

    it('reports a rejection again after the ad was approved in between (the dedupe key is per day)', async () => {
      const entities = stack.api.get(EntitySyncService);
      const conn = await connection();
      const campaign = stack.meta.createObject('campaign', metaAccountId, {
        name: 'Reviewed',
        objective: 'OUTCOME_TRAFFIC',
        status: 'ACTIVE',
        special_ad_categories: [],
      });
      const adSet = stack.meta.createObject('adset', metaAccountId, {
        name: 'Reviewed',
        campaign_id: campaign.id,
        status: 'ACTIVE',
        daily_budget: '5000',
      });
      const ad = stack.meta.createObject('ad', metaAccountId, {
        name: 'Reviewed ad',
        adset_id: adSet.id,
        campaign_id: campaign.id,
        status: 'ACTIVE',
        effective_status: 'DISAPPROVED',
        ad_review_feedback: { global: { ADVERTISING_POLICY: 'Misleading claims' } },
      });
      const rejections = () =>
        stack.prisma.notification.findMany({
          where: { userId: user.id, type: 'AD_REJECTED' },
          orderBy: { createdAt: 'asc' },
        });
      await entities.syncAccount(await account(), conn);
      const [first] = await rejections();
      expect(first.dedupeKey).toBe(`ad-status:${ad.id}:DISAPPROVED:${new Date().toISOString().slice(0, 10)}`);

      // Approved after an appeal, rejected again on a later day (the first alert is dated back accordingly).
      ad.fields.effective_status = 'ACTIVE';
      await entities.syncAccount(await account(), conn);
      await stack.prisma.notification.update({
        where: { id: first.id },
        data: { dedupeKey: `ad-status:${ad.id}:DISAPPROVED:2026-01-01` },
      });
      ad.fields.effective_status = 'DISAPPROVED';
      await entities.syncAccount(await account(), conn);
      expect(await rejections()).toHaveLength(2);

      // The same flip twice on one day: the duplicate alert is skipped and the sync still commits the status.
      const adRow = () =>
        stack.prisma.ad.findUniqueOrThrow({
          where: { adAccountId_metaAdId: { adAccountId: accountId, metaAdId: ad.id } },
        });
      ad.fields.effective_status = 'ACTIVE';
      await entities.syncAccount(await account(), conn);
      ad.fields.effective_status = 'DISAPPROVED';
      await entities.syncAccount(await account(), conn);
      expect(await rejections()).toHaveLength(2);
      expect((await adRow()).effectiveStatus).toBe('DISAPPROVED');
    });
  });

  describe('alerts', () => {
    it('a status change and its alert commit together: a failed alert rolls the change back and the retry reports it', async () => {
      const status = stack.api.get(MetaProfileStatusService);
      const alertsBefore = await tokenAlerts();
      const accountAlerts = () =>
        stack.prisma.notification.count({ where: { userId: user.id, type: 'AD_ACCOUNT_STATUS_CHANGED' } });
      const history = () => stack.prisma.accountStatusHistory.count({ where: { adAccountId: accountId } });
      const { tokenFingerprint } = await profile();
      await stack.prisma.$executeRawUnsafe(
        `CREATE FUNCTION test_fail_alert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'alert insert failed'; END $$`,
      );
      await stack.prisma.$executeRawUnsafe(
        `CREATE TRIGGER test_fail_alert BEFORE INSERT ON notifications FOR EACH ROW WHEN (NEW.type IN ('TOKEN_REVOKED', 'AD_ACCOUNT_STATUS_CHANGED')) EXECUTE FUNCTION test_fail_alert()`,
      );
      try {
        // Token status: nothing is committed when the alert cannot be written.
        await expect(status.onApiError(profileId, graphError(revoked), tokenFingerprint)).rejects.toThrow(
          /alert insert failed/,
        );
        expect((await profile()).status).toBe('ACTIVE');

        // Ad account status (worker job): the attempt fails as a whole and is retried later.
        stack.meta.accounts.get(metaAccountId)!.account_status = 2;
        await stack.prisma.adAccount.update({
          where: { id: accountId },
          data: { nextStatusCheckAt: new Date(Date.now() - 1000) },
        });
        await stack.runTask(AccountStatusTask);
        await stack.waitFor(async () => (await delayedJobs('account-status')) > 0, {
          intervalMs: 250,
          message: 'the status check did not fail',
        });
        expect((await account()).accountStatus).toBe(1);
        expect(await history()).toBe(0);
      } finally {
        await stack.prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_fail_alert ON notifications');
        await stack.prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_alert()');
      }

      await status.onApiError(profileId, graphError(revoked), tokenFingerprint);
      expect((await profile()).status).toBe('INVALID');
      expect(await tokenAlerts()).toBe(alertsBefore + 1);
      // Status checks run for active profiles only.
      expectStatus(await user.client.post(`/api/meta-profiles/${profileId}/validate`, {}), 200);

      await stack.promoteDelayed('account-status');
      await stack.waitFor(async () => (await history()) === 1, {
        message: 'the retried status check did not record the change',
      });
      expect((await account()).accountStatus).toBe(2);
      expect(await accountAlerts()).toBe(1);
      stack.meta.accounts.get(metaAccountId)!.account_status = 1;
    });

    it('the "token expires soon" warning is claimed together with its alert, so the retry sends a failed one', async () => {
      const warnings = () =>
        stack.prisma.notification.count({ where: { userId: user.id, type: 'TOKEN_EXPIRING_SOON' } });
      for (const t of stack.meta.tokens.values()) t.expiresAt = Math.floor(Date.now() / 1000) + 3 * 86400;
      await stack.prisma.metaProfile.update({
        where: { id: profileId },
        data: { expiryWarnedAt: null, nextTokenCheckAt: new Date(Date.now() - 1000) },
      });
      const delayedBefore = await delayedJobs('meta-sync');
      await stack.prisma.$executeRawUnsafe(
        `CREATE FUNCTION test_fail_warning() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'alert insert failed'; END $$`,
      );
      await stack.prisma.$executeRawUnsafe(
        `CREATE TRIGGER test_fail_warning BEFORE INSERT ON notifications FOR EACH ROW WHEN (NEW.type = 'TOKEN_EXPIRING_SOON') EXECUTE FUNCTION test_fail_warning()`,
      );
      try {
        await stack.runTask(TokenCheckTask);
        await stack.waitFor(async () => (await delayedJobs('meta-sync')) > delayedBefore, {
          intervalMs: 250,
          message: 'the token check did not fail',
        });
        expect((await profile()).expiryWarnedAt).toBeNull();
      } finally {
        await stack.prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_fail_warning ON notifications');
        await stack.prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_fail_warning()');
      }

      await stack.promoteDelayed('meta-sync');
      await stack.waitFor(async () => (await warnings()) === 1, {
        message: 'the retried token check did not send the warning',
      });
      expect((await profile()).expiryWarnedAt).not.toBeNull();
      for (const t of stack.meta.tokens.values()) t.expiresAt = 0;
    });
  });
});
