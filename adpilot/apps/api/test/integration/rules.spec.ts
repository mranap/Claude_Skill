import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { RuleEngineService } from '../../src/modules/rules/rule-engine.service';
import { StatisticsSyncTask } from '../../src/scheduler/tasks/statistics.tasks';
import { TestStack, type TestUser } from '../support/harness';
import { expectStatus } from '../support/http-client';

describe('automated rules (safeguards, idempotency, live state)', () => {
  const stack = new TestStack();
  let user: TestUser;
  let accountId: string;
  let metaAccountId: string;
  const sets: Record<string, string> = {};
  const today = () => DateTime.now().setZone('Europe/Warsaw').toFormat('yyyy-MM-dd');
  const engine = () => stack.worker!.get(RuleEngineService);

  const rule = (overrides: Record<string, unknown>) => ({
    name: 'High CPL',
    isActive: true,
    targetLevel: 'ADSET',
    scope: { adAccountIds: [accountId] },
    conditions: [{ metric: 'cpl', operator: 'gt', value: '20' }],
    timeRange: 'TODAY',
    action: 'DECREASE_BUDGET',
    actionValue: '20',
    cooldownMinutes: 60,
    maxActionsPerDay: 3,
    checkIntervalMinutes: 60,
    notify: true,
    ...overrides,
  });

  const budgetOf = (key: string) => stack.meta.objects.get(sets[key]!)!.fields.daily_budget;

  beforeAll(async () => {
    await stack.start({ worker: true, scheduler: true });
    await stack.setSettings('security', { loginRateLimitPerMinute: 200 });
    const admin = await stack.loginSuperAdmin();
    user = await stack.createUser(admin);
    const world = stack.meta.seed();
    metaAccountId = world.accountIds[0]!;
    const profileId = expectStatus(await user.client.post('/api/meta-profiles', { name: 'Rules BM', accessToken: world.token }), 201).body.profile.id;
    await stack.waitFor(async () => (await stack.prisma.adAccount.count({ where: { profileId } })) === 2);
    expectStatus(await user.client.post('/api/ad-accounts/connect', { profileId, connect: [metaAccountId] }), 200);
    accountId = (await stack.prisma.adAccount.findFirstOrThrow({ where: { profileId, metaAccountId } })).id;

    // A campaign built outside the platform (e.g. in Ads Manager) with three ad sets.
    const campaign = stack.meta.createObject('campaign', metaAccountId, { name: 'Evergreen', objective: 'OUTCOME_LEADS', status: 'ACTIVE', special_ad_categories: [] });
    for (const [key, budget] of [['expensive', '4000'], ['cheap', '6000'], ['pausable', '5000']] as const) {
      sets[key] = stack.meta.createObject('adset', metaAccountId, {
        name: `Ad set ${key}`,
        campaign_id: campaign.id,
        status: 'ACTIVE',
        daily_budget: budget,
        optimization_goal: 'OFFSITE_CONVERSIONS',
        promoted_object: { pixel_id: world.pixelId, custom_event_type: 'LEAD' },
        targeting: { geo_locations: { countries: ['US'] } },
      }).id;
    }
    stack.meta.insightOverrides.set(`${sets.expensive}|${today()}`, { spend: '50.00', leads: 1 }); // CPL 50
    stack.meta.insightOverrides.set(`${sets.cheap}|${today()}`, { spend: '10.00', leads: 2 }); // CPL 5
    stack.meta.insightOverrides.set(`${sets.pausable}|${today()}`, { spend: '45.00', leads: 0 }); // no CPL

    await stack.prisma.adAccount.update({ where: { id: accountId }, data: { nextStatsSyncAt: null } });
    await stack.runTask(StatisticsSyncTask);
    await stack.waitFor(async () => (await stack.prisma.adSet.count({ where: { adAccountId: accountId } })) === 3, { timeoutMs: 30_000 });
  });
  afterAll(() => stack.stop());

  it('validates rules: no budget actions on ads, no foreign ad accounts, minimum check interval', async () => {
    expect((await user.client.post('/api/rules', rule({ targetLevel: 'AD' }))).status).toBe(400);
    expect((await user.client.post('/api/rules', rule({ checkIntervalMinutes: 15 }))).status).toBe(400);
    expect((await user.client.post('/api/rules', rule({ scope: { adAccountIds: ['00000000-0000-4000-8000-000000000000'] } }))).status).toBe(404);
  });

  it('acts only on matching objects, applies the minimum budget floor, notifies once and respects the cooldown', async () => {
    const created = expectStatus(await user.client.post('/api/rules', rule({ minBudget: '35' })), 201).body;
    expectStatus(await user.client.post(`/api/rules/${created.id}/run`), 202);
    await stack.waitFor(async () => (await stack.prisma.autoRuleExecution.count({ where: { ruleId: created.id, result: 'SUCCESS' } })) === 1);

    // 40.00 − 20 % = 32.00, kept at the rule minimum of 35.00; the cheap ad set does not match.
    expect(budgetOf('expensive')).toBe('3500');
    expect(budgetOf('cheap')).toBe('6000');
    const exec = await stack.prisma.autoRuleExecution.findFirstOrThrow({ where: { ruleId: created.id, result: 'SUCCESS' } });
    expect(exec).toMatchObject({ oldValue: '4000', newValue: '3500' });
    expect(exec.reason).toMatch(/minimum 35\.00 USD/);
    const notes = await stack.prisma.notification.findMany({ where: { userId: user.id, type: 'AUTO_RULE_TRIGGERED' } });
    expect(notes).toHaveLength(1);

    // "Run now" twice within a minute is refused with a clear cooldown message.
    expect((await user.client.post(`/api/rules/${created.id}/run`)).status).toBe(429);

    // A second evaluation within the cooldown does nothing.
    const posts = () => stack.meta.requests.filter((r) => r.method === 'POST' && r.path === `/${sets.expensive}`).length;
    const before = posts();
    await engine().run(created.id, { manual: true });
    expect(posts()).toBe(before);
    expect(budgetOf('expensive')).toBe('3500');
    const skipped = await stack.prisma.autoRuleExecution.findFirst({ where: { ruleId: created.id, result: 'SKIPPED' } });
    expect(skipped?.reason).toMatch(/Cooldown/);
  });

  it('computes relative changes from the live Meta budget, not a stale local copy', async () => {
    // The budget was changed in Ads Manager after the last sync; the local mirror still says 60.00.
    stack.meta.objects.get(sets.cheap!)!.fields.daily_budget = '9000';
    stack.meta.insightOverrides.set(`${sets.cheap}|${today()}`, { spend: '90.00', leads: 1 }); // CPL 90
    const created = expectStatus(await user.client.post('/api/rules', rule({ name: 'Live state', scope: { adAccountIds: [accountId], nameContains: 'cheap' } })), 201).body;
    await engine().run(created.id, { manual: true });
    expect(budgetOf('cheap')).toBe('7200'); // 90.00 − 20 %, not 60.00 − 20 %
    const mirror = await stack.prisma.adSet.findFirstOrThrow({ where: { metaAdSetId: sets.cheap } });
    expect(mirror.dailyBudget).toBe(7200n);
  });

  it('dry run records what would happen without touching Meta', async () => {
    const created = expectStatus(
      await user.client.post('/api/rules', rule({ name: 'Scale winners', isDryRun: true, conditions: [{ metric: 'spend', operator: 'gte', value: '1' }], action: 'INCREASE_BUDGET', actionValue: '100', maxBudgetChangePercent: '30', maxBudget: '80' })),
      201,
    ).body;
    const budgets = Object.keys(sets).map(budgetOf);
    await engine().run(created.id, { manual: true });
    expect(Object.keys(sets).map(budgetOf)).toEqual(budgets);
    const rows = await stack.prisma.autoRuleExecution.findMany({ where: { ruleId: created.id } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.result === 'DRY_RUN' && r.isDryRun)).toBe(true);
    // +100 % is limited to +30 % per execution and capped at 80.00.
    const cheap = rows.find((r) => r.entityMetaId === sets.cheap)!;
    expect(cheap).toMatchObject({ oldValue: '7200', newValue: '8000' });
  });

  it('an action interrupted by a crash is verified in Meta before anything is repeated', async () => {
    const created = expectStatus(await user.client.post('/api/rules', rule({ name: 'Stop spenders', conditions: [{ metric: 'spend', operator: 'gt', value: '40' }], action: 'PAUSE', actionValue: undefined, scope: { adAccountIds: [accountId], nameContains: 'pausable' } })), 201).body;
    // A previous worker recorded the intent and died before Meta was called (Meta still shows ACTIVE).
    await stack.prisma.autoRuleExecution.create({
      data: {
        ruleId: created.id,
        userId: user.id,
        runId: '00000000-0000-4000-8000-000000000001',
        adAccountId: accountId,
        entityLevel: 'ADSET',
        entityMetaId: sets.pausable!,
        entityName: 'Ad set pausable',
        action: 'PAUSE',
        result: 'PENDING',
        oldValue: 'ACTIVE',
        newValue: 'PAUSED',
        conditionData: {},
        executedAt: new Date(Date.now() - 10 * 60_000),
      },
    });
    await engine().run(created.id, { manual: true });
    const rows = await stack.prisma.autoRuleExecution.findMany({ where: { ruleId: created.id }, orderBy: { executedAt: 'asc' } });
    expect(rows[0]!.result).toBe('FAILED');
    expect(rows[0]!.errorMessage).toMatch(/not applied/);
    expect(rows.filter((r) => r.result === 'SUCCESS')).toHaveLength(1);
    expect(stack.meta.objects.get(sets.pausable!)!.fields.status).toBe('PAUSED');
    const pauseCalls = stack.meta.requests.filter((r) => r.method === 'POST' && r.path === `/${sets.pausable}` && r.params.status === 'PAUSED');
    expect(pauseCalls).toHaveLength(1);
  });

  it('two workers never evaluate the same rule at the same time', async () => {
    const created = expectStatus(await user.client.post('/api/rules', rule({ name: 'Notify only', action: 'NOTIFY_ONLY', actionValue: undefined })), 201).body;
    const [a, b] = await Promise.all([engine().run(created.id, { manual: true }), engine().run(created.id, { manual: true })]);
    // The loser gets { skipped: '<reason>' } (a completed run reports a numeric `skipped` counter).
    const skipped = [a, b].filter((r) => typeof (r as { skipped: unknown }).skipped === 'string');
    expect(skipped).toHaveLength(1);
  });

  it('rules are private to their owner', async () => {
    const admin = await stack.loginSuperAdmin();
    const other = await stack.createUser(admin);
    const mine = expectStatus(await user.client.get('/api/rules'), 200).body.items[0];
    expect((await other.client.get(`/api/rules/${mine.id}`)).status).toBe(404);
    expect((await other.client.post(`/api/rules/${mine.id}/run`)).status).toBe(404);
    expect((await other.client.delete(`/api/rules/${mine.id}`)).status).toBe(404);
    expect(expectStatus(await other.client.get('/api/rules/executions'), 200).body.items).toEqual([]);
  });
});
