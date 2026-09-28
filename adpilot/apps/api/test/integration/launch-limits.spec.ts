import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LAUNCH_JOB_TERMINAL_STATUSES, type LaunchJobStatus } from '@adpilot/shared';
import { LockService } from '../../src/infra/locks/lock.service';
import { LaunchExecutorService } from '../../src/modules/launches/launch-executor.service';
import { TestStack, type TestUser } from '../support/harness';
import { expectStatus } from '../support/http-client';
import { generateMedia, uploadCreative } from '../support/media';

type LaunchView = {
  id: string;
  code: string;
  status: LaunchJobStatus;
  error: { message?: string } | null;
  warnings: { path: string; message: string }[] | null;
  items: { key: string; kind: string; status: string; lastError?: { message?: string } | null; errorCategory?: string | null }[];
};

describe('launch limits (Meta minimums, bounded waits, leases, daily caps, activation)', () => {
  const stack = new TestStack();
  let user: TestUser;
  let world: ReturnType<TestStack['meta']['seed']>;
  let profileId: string;
  let adAccountId: string;
  const files: Record<string, string> = {};

  beforeAll(async () => {
    await stack.start({ worker: true });
    await stack.setSettings('security', { loginRateLimitPerMinute: 200 });
    const admin = await stack.loginSuperAdmin();
    user = await stack.createUser(admin);
    world = stack.meta.seed();
    stack.meta.videoPollsUntilReady = 1;
    profileId = expectStatus(await user.client.post('/api/meta-profiles', { name: 'Limits BM', accessToken: world.token }), 201).body.profile.id;
    await stack.waitFor(async () => (await stack.prisma.adAccount.count({ where: { profileId } })) === 2);
    expectStatus(await user.client.post('/api/ad-accounts/connect', { profileId, connect: [world.accountIds[0]] }), 200);
    adAccountId = (await stack.prisma.adAccount.findFirstOrThrow({ where: { profileId, metaAccountId: world.accountIds[0] } })).id;
    await stack.waitFor(async () => (await stack.prisma.pixel.count({ where: { adAccountId } })) > 0, { message: 'pixels not synced' });

    const media = generateMedia(`${process.env.TMP_DIR}/media`);
    files.videoA = (await uploadCreative(user.client, media.videoA, 'video/mp4')).id;
    files.videoB = (await uploadCreative(user.client, media.videoB, 'video/mp4')).id;
    files.imageA = (await uploadCreative(user.client, media.imageA, 'image/jpeg')).id;
  });
  afterAll(() => stack.stop());

  function config(o: { name?: string; video?: string; activate?: boolean; settings?: Record<string, unknown>; variants?: unknown[] } = {}) {
    const creative = o.video ?? files.imageA;
    return {
      profileId,
      adAccountId,
      name: o.name ?? 'Limits',
      settings: {
        objective: 'OUTCOME_LEADS',
        destination: 'WEBSITE',
        optimizationGoal: 'OFFSITE_CONVERSIONS',
        conversion: { pixelId: world.pixelId, event: 'LEAD' },
        budget: { level: 'ADSET', type: 'DAILY', amount: '25.00' },
        identity: { pageId: world.pageId },
        dsa: { beneficiary: 'Joint Care Sp. z o.o.', payor: 'Joint Care Sp. z o.o.' },
        creative: { format: o.video ? 'SINGLE_VIDEO' : 'SINGLE_IMAGE', callToAction: 'LEARN_MORE' },
        activateOnSuccess: o.activate ?? false,
        ...o.settings,
      },
      variants: o.variants ?? [
        { key: 'en', label: 'EN', countries: ['US'], ads: [{ key: 'a1', creativeFileId: creative, primaryText: 'Hello', headline: 'Try it', link: 'https://example.com/en' }] },
        { key: 'pl', label: 'PL', countries: ['PL'], ads: [{ key: 'a1', creativeFileId: creative, primaryText: 'Cześć', headline: 'Spróbuj', link: 'https://example.com/pl' }] },
      ],
    };
  }

  const key = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const campaignOf = (job: LaunchView) => stack.meta.objectsOf('campaign').find((o) => String(o.fields.name).includes(job.code));

  async function launch(cfg: ReturnType<typeof config>): Promise<string> {
    return (expectStatus(await user.client.post('/api/launches', { idempotencyKey: key('limits'), config: cfg }), 202).body as { job: { id: string } }).job.id;
  }

  /** Waits for a terminal status, fast-forwarding deferred jobs and Meta rate-limit cool-downs. */
  async function waitForLaunch(id: string): Promise<LaunchView> {
    return stack.waitFor(
      async () => {
        const job = expectStatus(await user.client.get(`/api/launches/${id}`), 200).body as LaunchView;
        if (LAUNCH_JOB_TERMINAL_STATUSES.includes(job.status)) return job;
        await stack.clearMetaRateLimits();
        await stack.promoteDelayed('campaign-launch');
        await stack.promoteDelayed('creative-upload');
        return null;
      },
      { timeoutMs: 60_000, intervalMs: 250, message: 'launch did not finish' },
    );
  }

  function expectLaunchStatus(job: LaunchView, status: string) {
    const unfinished = job.items.filter((i) => !['CREATED', 'VERIFIED'].includes(i.status)).map((i) => ({ key: i.key, status: i.status, category: i.errorCategory, error: i.lastError }));
    expect(job.status, JSON.stringify({ error: job.error, unfinished })).toBe(status);
  }

  it("checks Meta's budget minimums, the spend cap minimum and creative links before anything is sent", async () => {
    const posts = stack.meta.requests.filter((r) => r.method === 'POST').length;
    const validate = async (cfg: ReturnType<typeof config>) =>
      expectStatus(await user.client.post('/api/launches/validate', { config: cfg }), 200).body as { ok: boolean; errors: { path: string; message: string }[] };
    const errorsOf = async (settings: Record<string, unknown>) => (await validate(config({ settings }))).errors;

    // The seeded USD account reports min_daily_budget = 100 (1.00 USD). A campaign budget covers every ad set.
    expect(await errorsOf({ budget: { level: 'CAMPAIGN', type: 'DAILY', amount: '1.50' } })).toContainEqual({
      path: 'settings.budget.amount',
      message: 'The daily budget must be at least 2.00 USD to cover the minimum of all 2 ad sets (1.00 USD per ad set: the ad account minimum)',
    });
    expect((await validate(config({ settings: { budget: { level: 'CAMPAIGN', type: 'DAILY', amount: '2.00' } } }))).ok).toBe(true);

    // Link-click billing needs five times the impression minimum.
    const traffic = { objective: 'OUTCOME_TRAFFIC', optimizationGoal: 'LINK_CLICKS', billingEvent: 'LINK_CLICKS', conversion: {} };
    expect(await errorsOf({ ...traffic, budget: { level: 'ADSET', type: 'DAILY', amount: '4.99' } })).toContainEqual({
      path: 'settings.budget.amount',
      message: 'The daily budget must be at least 5.00 USD (5 × the ad account minimum when billing on link clicks or ThruPlays)',
    });
    // A bid cap: five times the bid when billing on clicks.
    const bidCap = { level: 'ADSET', type: 'DAILY', amount: '9.99', bidStrategy: 'LOWEST_COST_WITH_BID_CAP', bidAmount: '2.00' };
    expect((await errorsOf({ ...traffic, budget: bidCap })).map((e) => e.message)).toContain('The daily budget must be at least 10.00 USD (5 × the bid cap when billing on link clicks or ThruPlays)');

    // A lifetime budget covers the daily minimum on every day of the schedule.
    const endTime = new Date(Date.now() + 10 * 86_400_000).toISOString();
    expect(await errorsOf({ budget: { level: 'ADSET', type: 'LIFETIME', amount: '9.00' }, schedule: { endTime } })).toContainEqual({
      path: 'settings.budget.amount',
      message: 'The lifetime budget must be at least 10.00 USD over the schedule (1.00 USD per day: the ad account minimum)',
    });

    // The campaign spend cap cannot be below the account's min_campaign_group_spend_cap (100.00 USD here).
    await stack.prisma.adAccount.update({ where: { id: adAccountId }, data: { minCampaignGroupSpendCap: 10_000n } });
    expect(await errorsOf({ budget: { level: 'ADSET', type: 'DAILY', amount: '25', spendCap: '99.99' } })).toContainEqual({
      path: 'settings.budget.spendCap',
      message: 'The campaign spending limit must be at least 100.00 USD for this ad account',
    });

    // Engagement ads lead to a URL as well: only Instant-form ads may go without a link.
    const engagement = config({
      settings: { objective: 'OUTCOME_ENGAGEMENT', destination: 'ON_POST', optimizationGoal: 'POST_ENGAGEMENT', conversion: {} },
      variants: [{ key: 'en', label: 'EN', countries: ['US'], ads: [{ key: 'a1', creativeFileId: files.imageA, primaryText: 'Hi' }] }],
    });
    expect((await validate(engagement)).errors).toContainEqual({ path: 'variants.0.ads.0.link', message: 'Enter the website URL' });

    expect(stack.meta.requests.filter((r) => r.method === 'POST').length).toBe(posts);
  });

  it('a refused activation completes the launch with a warning and still syncs the campaign', async () => {
    stack.meta.inject({
      match: /^POST \/\d+$/,
      times: 1,
      kind: 'error',
      status: 400,
      error: { code: 100, message: 'Invalid parameter', error_user_msg: 'This campaign cannot be activated right now.', type: 'OAuthException' },
    });
    const job = await waitForLaunch(await launch(config({ name: 'Activation refused', activate: true })));
    expectLaunchStatus(job, 'COMPLETED');
    expect(job.warnings).toContainEqual({ path: 'activation', message: 'The campaign was created but not activated: This campaign cannot be activated right now.' });
    const campaign = campaignOf(job)!;
    expect(campaign.fields.status).toBe('PAUSED');
    // Refused once, not retried as a temporary error.
    expect(stack.meta.requests.filter((r) => r.method === 'POST' && r.path === `/${campaign.id}`)).toHaveLength(1);
    expect(await stack.prisma.campaign.count({ where: { metaCampaignId: campaign.id } })).toBe(1);
    const notification = await stack.waitFor(() => stack.prisma.notification.findFirst({ where: { userId: user.id, type: 'CAMPAIGN_LAUNCHED', link: `/launch/jobs/${job.id}` } }), {
      message: 'launch notification missing',
    });
    expect(notification.severity).toBe('WARNING');
    expect(notification.body).toMatch(/Meta did not activate the campaign: This campaign cannot be activated right now\. It is paused until you start it\./);
  });

  it("fails the launch on Meta's daily ad-creation limit instead of deferring it all day", async () => {
    stack.meta.inject({
      match: /^POST \/act_\d+\/ads$/,
      times: 1,
      kind: 'error',
      status: 400,
      error: { code: 613, error_subcode: 1487225, message: 'User request limit reached', type: 'OAuthException' },
    });
    const adRequests = () => stack.meta.requests.filter((r) => r.method === 'POST' && /^\/act_\d+\/ads$/.test(r.path)).length;
    const before = adRequests();
    const job = await waitForLaunch(await launch(config({ name: 'Daily cap' })));
    expectLaunchStatus(job, 'FAILED');
    expect(job.error?.message).toMatch(/daily limit for creating ads in this ad account was reached/);
    const capped = job.items.find((i) => i.status === 'FAILED')!;
    expect(capped).toMatchObject({ kind: 'AD', errorCategory: 'RATE_LIMIT' });
    expect(capped.lastError?.message).toMatch(/Retry the launch tomorrow/);
    // Nothing else is sent today: the second group is skipped, the refused request is not repeated.
    expect(job.items.filter((i) => i.key.endsWith(':pl:a1')).map((i) => i.status)).toEqual(['SKIPPED', 'SKIPPED']);
    expect(adRequests()).toBe(before + 1);
  });

  it('an interrupted ad whose ad set is gone fails instead of being re-checked forever', async () => {
    // The ad request is sent but the connection breaks (ambiguous); the lookup then finds no parent ad set.
    stack.meta.inject({ match: /^POST \/act_\d+\/ads$/, times: 1, kind: 'drop-before-process' });
    stack.meta.inject({
      match: /^GET \/\d+\/ads$/,
      times: 1,
      kind: 'error',
      status: 400,
      error: { code: 100, error_subcode: 33, message: "Unsupported get request. Object with ID '1' does not exist", type: 'GraphMethodException' },
    });
    const job = await waitForLaunch(await launch(config({ name: 'Parent gone' })));
    expectLaunchStatus(job, 'PARTIAL_FAILURE');
    // 100/33 means "deleted or no access" (VALIDATION, since it may be a permission problem); either way the
    // parent cannot hold the ad, so the item fails at once instead of being re-checked.
    expect(job.items.filter((i) => i.status === 'FAILED')).toEqual([expect.objectContaining({ key: 'ad:en:a1', errorCategory: 'VALIDATION' })]);
  });

  it('a second run of the same launch in the same process is refused, so nothing is created twice', async () => {
    await stack.stopWorker();
    try {
      const id = await launch(config({ name: 'Two runs' }));
      const executor = stack.api.get(LaunchExecutorService);
      const outcomes = await Promise.all([executor.run(id), executor.run(id)]);
      expect(outcomes.map((o) => o.kind).sort()).toEqual(['busy', 'done']);
      const job = expectStatus(await user.client.get(`/api/launches/${id}`), 200).body as LaunchView;
      expectLaunchStatus(job, 'COMPLETED');
      const campaigns = stack.meta.objectsOf('campaign').filter((o) => String(o.fields.name).includes(job.code));
      expect(campaigns).toHaveLength(1);
      expect(stack.meta.objectsOf('ad').filter((o) => o.fields.campaign_id === campaigns[0].id)).toHaveLength(2);
    } finally {
      await stack.startWorker();
    }
  });

  it('a launch and a library pre-upload of the same video share the asset lock: the file is uploaded once', async () => {
    const asset = await stack.prisma.creativeMetaAsset.upsert({
      where: { creativeFileId_adAccountId: { creativeFileId: files.videoB, adAccountId } },
      create: { userId: user.id, creativeFileId: files.videoB, adAccountId },
      update: {},
    });
    const locks = stack.api.get(LockService);
    const held = await locks.acquire(`creative-asset:${asset.id}`, 60_000);
    expect(held).not.toBeNull();
    const starts = () => stack.meta.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/advideos') && r.params.upload_phase === 'start').length;
    const before = starts();

    const id = await launch(config({ name: 'Shared video', video: files.videoB }));
    expectStatus(await user.client.post(`/api/creatives/${files.videoB}/meta-upload`, { adAccountId }), 202);
    // While another worker holds the asset, the launch waits instead of uploading.
    await stack.waitFor(() => stack.prisma.launchJobItem.findFirst({ where: { launchJobId: id, kind: 'MEDIA_VIDEO', deferredSince: { not: null } } }));
    expect(starts()).toBe(before);

    await locks.release(held!);
    const job = await waitForLaunch(id);
    expectLaunchStatus(job, 'COMPLETED');
    await stack.waitFor(async () => (await stack.prisma.creativeMetaAsset.findUniqueOrThrow({ where: { id: asset.id } })).status === 'READY');
    expect(starts()).toBe(before + 1);
  });

  it('gives up on a video Meta never finishes processing instead of waiting forever', async () => {
    stack.meta.videoPollsUntilReady = 1_000_000;
    try {
      const id = await launch(config({ name: 'Stuck video', video: files.videoA }));
      const item = await stack.waitFor(async () => {
        await stack.promoteDelayed('campaign-launch');
        return stack.prisma.launchJobItem.findFirst({ where: { launchJobId: id, kind: 'MEDIA_VIDEO', deferredSince: { not: null } } });
      });
      // Two hours later Meta is still processing.
      await stack.prisma.launchJobItem.update({ where: { id: item.id }, data: { deferredSince: new Date(Date.now() - 2 * 3600_000 - 60_000) } });
      const job = await waitForLaunch(id);
      expectLaunchStatus(job, 'FAILED');
      expect(job.items.find((i) => i.kind === 'MEDIA_VIDEO')?.lastError?.message).toBe('Meta did not finish processing the video within 2 hours.');
      expect(campaignOf(job)).toBeUndefined();
    } finally {
      stack.meta.videoPollsUntilReady = 1;
    }
  });
});
