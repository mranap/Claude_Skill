import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LAUNCH_JOB_TERMINAL_STATUSES } from '@adpilot/shared';
import { TestStack, type TestUser } from '../support/harness';
import { expectStatus } from '../support/http-client';
import { generateMedia, uploadCreative } from '../support/media';

type Media = ReturnType<typeof generateMedia>;

describe('campaign launch engine (idempotency, reconciliation, deferrals)', () => {
  const stack = new TestStack();
  let user: TestUser;
  let world: ReturnType<TestStack['meta']['seed']>;
  let profileId: string;
  let adAccountId: string;
  let media: Media;
  const files: Record<string, string> = {};

  beforeAll(async () => {
    await stack.start({ worker: true, scheduler: true });
    await stack.setSettings('security', { loginRateLimitPerMinute: 200 });
    const admin = await stack.loginSuperAdmin();
    user = await stack.createUser(admin);
    world = stack.meta.seed();
    stack.meta.videoPollsUntilReady = 1;
    profileId = expectStatus(await user.client.post('/api/meta-profiles', { name: 'Launch BM', accessToken: world.token }), 201).body.profile.id;
    await stack.waitFor(async () => (await stack.prisma.adAccount.count({ where: { profileId } })) === 2);
    expectStatus(await user.client.post('/api/ad-accounts/connect', { profileId, connect: [world.accountIds[0]] }), 200);
    adAccountId = (await stack.prisma.adAccount.findFirstOrThrow({ where: { profileId, metaAccountId: world.accountIds[0] } })).id;
    // Pixels are imported by the asset sync of the connected account.
    await stack.waitFor(async () => (await stack.prisma.pixel.count({ where: { adAccountId } })) > 0, { message: 'pixels not synced' });

    media = generateMedia(`${process.env.TMP_DIR}/media`);
    files.videoA = (await uploadCreative(user.client, media.videoA, 'video/mp4')).id;
    files.videoB = (await uploadCreative(user.client, media.videoB, 'video/mp4')).id;
    files.imageA = (await uploadCreative(user.client, media.imageA, 'image/jpeg')).id;
  });
  afterAll(() => stack.stop());

  function config(overrides: { name?: string; video?: string; activate?: boolean; variants?: unknown[] } = {}) {
    return {
      profileId,
      adAccountId,
      name: overrides.name ?? 'Joint cream',
      settings: {
        objective: 'OUTCOME_LEADS',
        destination: 'WEBSITE',
        optimizationGoal: 'OFFSITE_CONVERSIONS',
        conversion: { pixelId: world.pixelId, event: 'LEAD' },
        budget: { level: 'ADSET', type: 'DAILY', amount: '25.00' },
        identity: { pageId: world.pageId },
        dsa: { beneficiary: 'Joint Care Sp. z o.o.', payor: 'Joint Care Sp. z o.o.' },
        creative: { format: 'SINGLE_VIDEO', callToAction: 'LEARN_MORE' },
        activateOnSuccess: overrides.activate ?? false,
      },
      variants: overrides.variants ?? [
        { key: 'en', label: 'EN', countries: ['US'], ads: [{ key: 'a1', creativeFileId: overrides.video ?? files.videoA, primaryText: 'Hello', headline: 'Try it', link: 'https://example.com/en' }] },
        { key: 'pl', label: 'PL', countries: ['PL'], budgetAmount: '40', ads: [{ key: 'a1', creativeFileId: overrides.video ?? files.videoA, primaryText: 'Cześć', headline: 'Spróbuj', link: 'https://example.com/pl' }] },
      ],
    };
  }

  /** Asserts the final status and prints the unfinished items (with Meta's error) when it differs. */
  function expectLaunchStatus(job: { status: string; items: { key: string; status: string; lastError?: unknown; errorCategory?: string | null }[] }, status: string) {
    const unfinished = job.items.filter((i) => !['CREATED', 'VERIFIED'].includes(i.status)).map((i) => ({ key: i.key, status: i.status, category: i.errorCategory, error: i.lastError }));
    expect(job.status, JSON.stringify(unfinished)).toBe(status);
  }

  const key = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  /** Waits for a terminal status, fast-forwarding deferred jobs (video processing, cool-downs, back-off). */
  async function waitForLaunch(id: string, timeoutMs = 60_000) {
    return stack.waitFor(
      async () => {
        const job = expectStatus(await user.client.get(`/api/launches/${id}`), 200).body;
        if (LAUNCH_JOB_TERMINAL_STATUSES.includes(job.status)) return job;
        await stack.promoteDelayed('campaign-launch');
        return null;
      },
      { timeoutMs, intervalMs: 250, message: 'launch did not finish' },
    );
  }

  const count = (type: 'campaign' | 'adset' | 'ad' | 'creative', code?: string) =>
    stack.meta.objectsOf(type).filter((o) => o.fields.status !== 'DELETED' && (!code || String(o.fields.name).includes(code) || type !== 'campaign')).length;

  it('dry run shows the exact plan and sends nothing to Meta', async () => {
    const before = stack.meta.requests.filter((r) => r.method === 'POST').length;
    const res = expectStatus(await user.client.post('/api/launches/dry-run', { config: config() }), 200).body;
    expect(res.ok).toBe(true);
    expect(res.summary).toMatchObject({ campaigns: 1, adSets: 2, ads: 2 });
    const adset = res.items.find((i: { kind: string }) => i.kind === 'ADSET');
    expect(adset.payload.targeting.targeting_automation).toEqual({ advantage_audience: 0 });
    expect(stack.meta.requests.filter((r) => r.method === 'POST').length).toBe(before);
  });

  it('rejects invalid configurations locally before calling Meta', async () => {
    const bad = config();
    (bad.settings as Record<string, unknown>).dsa = {};
    const res = await user.client.post('/api/launches', { idempotencyKey: key('invalid'), config: bad });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/Digital Services Act/);
    expect(await stack.prisma.launchJob.count()).toBe(0);
  });

  it('a double click creates exactly one launch and one set of Meta objects', async () => {
    const idempotencyKey = key('double');
    const [a, b] = await Promise.all([
      user.client.post('/api/launches', { idempotencyKey, config: config() }),
      user.client.post('/api/launches', { idempotencyKey, config: config() }),
    ]);
    expectStatus(a, 202);
    expectStatus(b, 202);
    expect(a.body.job.id).toBe(b.body.job.id);
    expect([a.body.duplicate, b.body.duplicate].sort()).toEqual([false, true]);
    expect(await stack.prisma.launchJob.count({ where: { idempotencyKey } })).toBe(1);

    const job = await waitForLaunch(a.body.job.id);
    expectLaunchStatus(job, 'COMPLETED');
    expect(job.items.every((i: { status: string }) => ['CREATED', 'VERIFIED'].includes(i.status))).toBe(true);

    const campaign = stack.meta.objectsOf('campaign').find((o) => String(o.fields.name).includes(job.code))!;
    expect(campaign.fields.status).toBe('PAUSED');
    const adsets = stack.meta.objectsOf('adset').filter((o) => o.fields.campaign_id === campaign.id);
    const ads = stack.meta.objectsOf('ad').filter((o) => o.fields.campaign_id === campaign.id);
    expect(adsets).toHaveLength(2);
    expect(ads).toHaveLength(2);
    expect(adsets.map((s) => s.fields.daily_budget).sort()).toEqual(['2500', '4000']);
    expect(stack.meta.videos.size).toBe(1);

    // A later retry of the same request (e.g. the browser resending) still returns the same job.
    const again = expectStatus(await user.client.post('/api/launches', { idempotencyKey, config: config() }), 202).body;
    expect(again.job.id).toBe(job.id);
    expect(again.duplicate).toBe(true);

    // Entities are synchronised into the platform and the user is notified.
    await stack.waitFor(async () => (await stack.prisma.ad.count({ where: { userId: user.id } })) === 2);
    const notification = await stack.prisma.notification.findFirst({ where: { userId: user.id, type: 'CAMPAIGN_LAUNCHED' } });
    expect(notification?.title).toBeTruthy();
  });

  it('reconciles an object whose creation response was lost (no duplicate ad)', async () => {
    stack.meta.inject({ match: /^POST \/act_\d+\/ads$/, times: 1, kind: 'drop-after-process' });
    const res = expectStatus(await user.client.post('/api/launches', { idempotencyKey: key('drop'), config: config({ name: 'Lost response' }) }), 202).body;
    const job = await waitForLaunch(res.job.id);
    expectLaunchStatus(job, 'COMPLETED');
    const campaign = stack.meta.objectsOf('campaign').find((o) => String(o.fields.name).includes(job.code))!;
    expect(stack.meta.objectsOf('ad').filter((o) => o.fields.campaign_id === campaign.id)).toHaveLength(2);
    const items = await stack.prisma.launchJobItem.findMany({ where: { launchJobId: job.id, kind: 'AD' } });
    expect(items.some((i) => (i.response as { reconciled?: boolean } | null)?.reconciled === true)).toBe(true);
  });

  it('re-sends a request that never reached processing only after the ambiguity window', async () => {
    stack.meta.inject({ match: /^POST \/act_\d+\/adsets$/, times: 1, kind: 'drop-before-process' });
    const res = expectStatus(await user.client.post('/api/launches', { idempotencyKey: key('lost'), config: config({ name: 'Lost request' }) }), 202).body;
    // The ad set is left IN_FLIGHT: nothing may be re-sent while Meta could still process the first request.
    const inFlight = await stack.waitFor(async () => {
      await stack.promoteDelayed('campaign-launch');
      return stack.prisma.launchJobItem.findFirst({ where: { launchJobId: res.job.id, kind: 'ADSET', status: 'IN_FLIGHT', attemptCount: { gte: 1 } } });
    });
    const adsetCount = stack.meta.objectsOf('adset').length;
    await stack.promoteDelayed('campaign-launch');
    await new Promise((r) => setTimeout(r, 1500));
    expect(stack.meta.objectsOf('adset').length).toBe(adsetCount);
    const still = await stack.prisma.launchJobItem.findUniqueOrThrow({ where: { id: inFlight.id } });
    expect(still.status).toBe('IN_FLIGHT');

    // Time passes beyond the window → the lookup proves it does not exist → it is created exactly once.
    await stack.prisma.launchJobItem.update({ where: { id: inFlight.id }, data: { inFlightSince: new Date(Date.now() - 10 * 60_000) } });
    const job = await waitForLaunch(res.job.id);
    expectLaunchStatus(job, 'COMPLETED');
    const campaign = stack.meta.objectsOf('campaign').find((o) => String(o.fields.name).includes(job.code))!;
    expect(stack.meta.objectsOf('adset').filter((o) => o.fields.campaign_id === campaign.id)).toHaveLength(2);
  });

  it('defers on Meta rate limits (no retry storm) and resumes without duplicates', async () => {
    const regain = JSON.stringify({ [world.businessId]: [{ type: 'ads_management', call_count: 100, total_cputime: 30, total_time: 30, estimated_time_to_regain_access: 5 }] });
    stack.meta.inject({
      match: /^POST \/act_\d+\/adsets$/,
      times: 1,
      kind: 'error',
      status: 400,
      error: { code: 17, error_subcode: 2446079, message: 'User request limit reached', type: 'OAuthException', is_transient: true },
      headers: { 'x-business-use-case-usage': regain },
    });
    const res = expectStatus(await user.client.post('/api/launches', { idempotencyKey: key('rl'), config: config({ name: 'Rate limited' }) }), 202).body;
    await stack.waitFor(async () => {
      const item = await stack.prisma.launchJobItem.findFirst({ where: { launchJobId: res.job.id, kind: 'ADSET', attemptCount: { gte: 1 } } });
      return item?.status === 'PENDING' ? item : null;
    });
    const postsBefore = stack.meta.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/adsets')).length;
    // While the scope is blocked, promoting the job does not send anything to Meta.
    await stack.promoteDelayed('campaign-launch');
    await new Promise((r) => setTimeout(r, 1500));
    expect(stack.meta.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/adsets')).length).toBe(postsBefore);

    await stack.clearMetaRateLimits();
    const job = await waitForLaunch(res.job.id);
    expectLaunchStatus(job, 'COMPLETED');
    const campaign = stack.meta.objectsOf('campaign').find((o) => String(o.fields.name).includes(job.code))!;
    expect(stack.meta.objectsOf('adset').filter((o) => o.fields.campaign_id === campaign.id)).toHaveLength(2);
  });

  it('survives a worker restart while waiting for video processing', async () => {
    stack.meta.videoPollsUntilReady = 3;
    const res = expectStatus(await user.client.post('/api/launches', { idempotencyKey: key('restart'), config: config({ name: 'Restart', video: files.videoB }) }), 202).body;
    await stack.waitFor(async () => (await stack.prisma.launchJob.findUniqueOrThrow({ where: { id: res.job.id } })).status === 'UPLOADING_CREATIVES');
    await stack.restartWorker();
    const job = await waitForLaunch(res.job.id);
    expectLaunchStatus(job, 'COMPLETED');
    expect(stack.meta.videos.size).toBe(2);
    const campaigns = stack.meta.objectsOf('campaign').filter((o) => String(o.fields.name).includes(job.code));
    expect(campaigns).toHaveLength(1);
    stack.meta.videoPollsUntilReady = 1;
  });

  it('partial failure keeps the campaign paused; retry creates only the missing objects', async () => {
    stack.meta.inject({
      match: /^POST \/act_\d+\/adsets$/,
      times: 1,
      kind: 'error',
      status: 400,
      error: { code: 100, error_subcode: 1885272, message: 'Invalid parameter', error_user_msg: 'Your budget is too low.', type: 'OAuthException' },
    });
    const res = expectStatus(await user.client.post('/api/launches', { idempotencyKey: key('partial'), config: config({ name: 'Partial', activate: true }) }), 202).body;
    const job = await waitForLaunch(res.job.id);
    expectLaunchStatus(job, 'PARTIAL_FAILURE');
    const failed = job.items.find((i: { status: string }) => i.status === 'FAILED');
    expect(failed.lastError.message).toBe('Your budget is too low.');
    const campaign = stack.meta.objectsOf('campaign').find((o) => String(o.fields.name).includes(job.code))!;
    expect(campaign.fields.status).toBe('PAUSED');
    expect(stack.meta.objectsOf('adset').filter((o) => o.fields.campaign_id === campaign.id)).toHaveLength(1);
    const notification = await stack.prisma.notification.findFirst({ where: { userId: user.id, type: 'CAMPAIGN_CREATION_FAILED' } });
    expect(notification).not.toBeNull();

    expectStatus(await user.client.post(`/api/launches/${job.id}/retry`), 200);
    const retried = await waitForLaunch(job.id);
    expectLaunchStatus(retried, 'COMPLETED');
    expect(stack.meta.objectsOf('campaign').filter((o) => String(o.fields.name).includes(job.code))).toHaveLength(1);
    expect(stack.meta.objectsOf('adset').filter((o) => o.fields.campaign_id === campaign.id)).toHaveLength(2);
    expect(stack.meta.objectsOf('ad').filter((o) => o.fields.campaign_id === campaign.id)).toHaveLength(2);
    // Activation happens only when everything exists.
    expect(stack.meta.objects.get(campaign.id)!.fields.status).toBe('ACTIVE');
  });

  it("another user cannot see, cancel or retry someone else's launch", async () => {
    const admin = await stack.loginSuperAdmin();
    const other = await stack.createUser(admin);
    const launch = await stack.prisma.launchJob.findFirstOrThrow({ where: { userId: user.id } });
    expect((await other.client.get(`/api/launches/${launch.id}`)).status).toBe(404);
    expect((await other.client.post(`/api/launches/${launch.id}/retry`)).status).toBe(404);
    expect((await other.client.post(`/api/launches/${launch.id}/cancel`)).status).toBe(404);
    expect(expectStatus(await other.client.get('/api/launches'), 200).body.items).toEqual([]);
  });
});
