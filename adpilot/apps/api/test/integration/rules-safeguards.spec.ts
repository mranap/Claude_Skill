import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { RuleEngineService } from '../../src/modules/rules/rule-engine.service';
import { entityLockName } from '../../src/modules/campaigns/entity-actions.service';
import { LockService } from '../../src/infra/locks/lock.service';
import { StatisticsSyncTask } from '../../src/scheduler/tasks/statistics.tasks';
import { AutoRulesTask } from '../../src/scheduler/tasks/rules.tasks';
import { TestStack, type TestUser } from '../support/harness';
import { expectStatus } from '../support/http-client';

describe('automated rules and budget changes: bounds, lost answers, leases, partial failures, idempotency', () => {
  const stack = new TestStack();
  let user: TestUser;
  let usdAccountId: string;
  let plnAccountId: string;
  let jpyAccountId: string;
  let usdMeta: string;
  const sets: Record<string, string> = {};
  const today = () => DateTime.now().setZone('Europe/Warsaw').toFormat('yyyy-MM-dd');
  const engine = () => stack.worker!.get(RuleEngineService);
  const budgetOf = (key: string) => stack.meta.objects.get(sets[key])!.fields.daily_budget;
  const statusOf = (key: string) => stack.meta.objects.get(sets[key])!.fields.status;
  const posts = (key: string) => stack.meta.requests.filter((r) => r.method === 'POST' && r.path === `/${sets[key]}`).length;
  const executions = (ruleId: string) => stack.prisma.autoRuleExecution.findMany({ where: { ruleId }, orderBy: { executedAt: 'asc' } });
  const notificationsOf = (name: string) => stack.prisma.notification.findMany({ where: { userId: user.id, type: 'AUTO_RULE_TRIGGERED', title: { contains: `"${name}"` } } });

  // Rules are created inactive and run explicitly; only the scheduler test activates its own rule.
  const rule = (overrides: Record<string, unknown>) => ({
    name: 'Rule',
    isActive: false,
    targetLevel: 'ADSET',
    scope: { adAccountIds: [usdAccountId] },
    conditions: [{ metric: 'spend', operator: 'gte', value: '1' }],
    timeRange: 'TODAY',
    action: 'PAUSE',
    cooldownMinutes: 60,
    maxActionsPerDay: 3,
    checkIntervalMinutes: 60,
    notify: true,
    ...overrides,
  });
  const createRule = async (overrides: Record<string, unknown>) => expectStatus(await user.client.post('/api/rules', rule(overrides)), 201).body as { id: string };

  beforeAll(async () => {
    await stack.start({ worker: true, scheduler: true });
    await stack.setSettings('security', { loginRateLimitPerMinute: 200 });
    const admin = await stack.loginSuperAdmin();
    user = await stack.createUser(admin);
    const world = stack.meta.seed();
    const [usd, pln] = world.accountIds as [string, string];
    usdMeta = usd;
    // A third ad account in yen, a currency without minor units.
    const jpy = String(3000000000 + Math.floor(Math.random() * 1e8));
    stack.meta.accounts.set(jpy, { ...stack.meta.accounts.get(pln)!, account_id: jpy, name: 'Tokyo JPY', currency: 'JPY', timezone_name: 'Asia/Tokyo', timezone_offset_hours_utc: 9, min_daily_budget: 100 });
    stack.meta.tokens.get(world.token)!.adAccounts.push(jpy);

    const profileId = expectStatus(await user.client.post('/api/meta-profiles', { name: 'Safeguards BM', accessToken: world.token }), 201).body.profile.id;
    await stack.waitFor(async () => (await stack.prisma.adAccount.count({ where: { profileId } })) === 3);
    expectStatus(await user.client.post('/api/ad-accounts/connect', { profileId, connect: [usd, pln] }), 200);
    const accountId = async (metaAccountId: string) => (await stack.prisma.adAccount.findFirstOrThrow({ where: { profileId, metaAccountId } })).id;
    [usdAccountId, plnAccountId, jpyAccountId] = [await accountId(usd), await accountId(pln), await accountId(jpy)];

    const adSets: [string, string, string][] = [
      [usd, 'bounded', '80000'],
      [usd, 'unanswered', '5000'],
      [usd, 'dry', '5000'],
      [usd, 'fenced', '5000'],
      [usd, 'manual', '4000'],
      [usd, 'partial-usd', '5000'],
      [pln, 'partial-pln', '5000'],
    ];
    const campaigns = new Map<string, string>();
    for (const [account, key, budget] of adSets) {
      if (!campaigns.has(account)) {
        campaigns.set(account, stack.meta.createObject('campaign', account, { name: `Evergreen ${account}`, objective: 'OUTCOME_LEADS', status: 'ACTIVE', special_ad_categories: [] }).id);
      }
      sets[key] = stack.meta.createObject('adset', account, {
        name: `Ad set ${key}`,
        campaign_id: campaigns.get(account),
        status: 'ACTIVE',
        daily_budget: budget,
        optimization_goal: 'OFFSITE_CONVERSIONS',
        promoted_object: { pixel_id: world.pixelId, custom_event_type: 'LEAD' },
        targeting: { geo_locations: { countries: ['US'] } },
      }).id;
      stack.meta.insightOverrides.set(`${sets[key]}|${today()}`, { spend: '20.00', impressions: 5000, leads: 1 });
    }

    await stack.prisma.adAccount.updateMany({ where: { id: { in: [usdAccountId, plnAccountId] } }, data: { nextStatsSyncAt: null } });
    await stack.runTask(StatisticsSyncTask);
    await stack.waitFor(async () => (await stack.prisma.adSet.count({ where: { userId: user.id } })) === adSets.length, { timeoutMs: 30_000 });
  });
  afterAll(() => stack.stop());

  it('checks amounts against the account currency and rejects conversion metrics for "Last N hours"', async () => {
    const yen = await user.client.post('/api/rules', rule({ scope: { adAccountIds: [jpyAccountId] }, action: 'DECREASE_BUDGET', actionValue: '20', minBudget: '100.5' }));
    expect(yen.status).toBe(400);
    expect(yen.body.error.details).toEqual([{ path: 'minBudget', message: 'JPY amounts cannot have decimals' }]);
    const cents = await user.client.post('/api/rules', rule({ action: 'SET_BUDGET', actionValue: '25.505' }));
    expect(cents.status).toBe(400);
    expect(cents.body.error.details).toEqual([{ path: 'actionValue', message: 'Use at most 2 decimals' }]);
    const hourly = await user.client.post('/api/rules', rule({ timeRange: 'LAST_N_HOURS', timeRangeValue: 6, conditions: [{ metric: 'leads', operator: 'lt', value: '1' }] }));
    expect(hourly.status).toBe(400);
    expect(hourly.body.error.details[0]).toMatchObject({ path: 'conditions.0.metric', message: expect.stringMatching(/website conversions/) });
    await createRule({ action: 'SET_BUDGET', actionValue: '25.50', scope: { adAccountIds: [usdAccountId], nameContains: 'nothing matches this' } });

    // A rule saved before that check does not run on missing data; it reports why.
    const old = await createRule({ name: 'Old hourly', timeRange: 'LAST_N_HOURS', timeRangeValue: 6 });
    await stack.prisma.autoRule.update({ where: { id: old.id }, data: { conditions: [{ metric: 'spend', operator: 'gt', value: '1' }, { metric: 'leads', operator: 'lt', value: '1' }] } });
    const insightCalls = stack.meta.requests.filter((r) => r.path.endsWith('/insights')).length;
    await engine().run(old.id, { manual: true });
    expect(stack.meta.requests.filter((r) => r.path.endsWith('/insights')).length).toBe(insightCalls);
    expect(await stack.prisma.autoRule.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ lastRunStatus: 'ERROR', lastRunError: expect.stringMatching(/^Leads is not available for "Last N hours"/) });

    // An amount saved before amounts were checked is reported in the history instead of failing without a trace.
    const oldAmount = await createRule({ name: 'Old amount', action: 'SET_BUDGET', actionValue: '25.50', scope: { adAccountIds: [usdAccountId], nameContains: 'bounded' } });
    await stack.prisma.autoRule.update({ where: { id: oldAmount.id }, data: { actionValue: '25.505' } });
    await engine().run(oldAmount.id, { manual: true });
    expect(await executions(oldAmount.id)).toMatchObject([{ result: 'SKIPPED', reason: 'Invalid amount in the rule: Use at most 2 decimals' }]);
    expect(posts('bounded')).toBe(0);
  });

  it('a maximum below the current budget never turns an increase into a cut', async () => {
    const created = await createRule({ name: 'Scale', action: 'INCREASE_BUDGET', actionValue: '20', maxBudgetChangePercent: '20', maxBudget: '500', scope: { adAccountIds: [usdAccountId], nameContains: 'bounded' } });
    await engine().run(created.id, { manual: true });
    expect(budgetOf('bounded')).toBe('80000'); // was set to 500.00 (−37.5 %) before
    expect(posts('bounded')).toBe(0);
    const rows = await executions(created.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ result: 'SKIPPED', reason: 'Budget 800.00 USD is already at or above the maximum 500.00 USD' });
  });

  it('a change whose answer was lost stays PENDING: the cooldown holds until Meta confirms it', async () => {
    const created = await createRule({ name: 'Lost answer', action: 'INCREASE_BUDGET', actionValue: '20', scope: { adAccountIds: [usdAccountId], nameContains: 'unanswered' } });
    // Meta applies the change, but the connection breaks before the answer arrives (also on both retries).
    stack.meta.inject({ match: new RegExp(`^POST /${sets.unanswered}$`), times: 3, kind: 'drop-after-process' });
    await engine().run(created.id, { manual: true });
    expect(budgetOf('unanswered')).toBe('6000');
    let [row] = await executions(created.id);
    expect(row).toMatchObject({ result: 'PENDING', oldValue: '5000', newValue: '6000' });
    expect(row.errorMessage).toMatch(/Could not reach the Meta API/);
    await stack.waitFor(async () => (await notificationsOf('Lost answer')).length === 1);
    expect((await notificationsOf('Lost answer'))[0].body).toMatch(/not confirmed by Meta/);

    // Recording FAILED used to lift the cooldown: the next run read 60.00 and added another 20 %.
    const before = posts('unanswered');
    await engine().run(created.id, { manual: true });
    expect(posts('unanswered')).toBe(before);
    expect(budgetOf('unanswered')).toBe('6000');
    expect((await executions(created.id))[0]).toMatchObject({ id: row.id, result: 'PENDING' });

    // Once it is old enough to be settled, the next evaluation verifies it in Meta; the cooldown still applies.
    await stack.prisma.autoRuleExecution.update({ where: { id: row.id }, data: { executedAt: new Date(Date.now() - 10 * 60_000) } });
    await engine().run(created.id, { manual: true });
    [row] = await executions(created.id);
    expect(row).toMatchObject({ result: 'SUCCESS', errorMessage: null });
    expect(posts('unanswered')).toBe(before);
    expect(budgetOf('unanswered')).toBe('6000');
  });

  it('a dry run respects the cooldown like the live rule would', async () => {
    const created = await createRule({ name: 'Preview', isDryRun: true, scope: { adAccountIds: [usdAccountId], nameContains: 'dry' } });
    await engine().run(created.id, { manual: true });
    await engine().run(created.id, { manual: true });
    const rows = await executions(created.id);
    expect(rows.map((r) => r.result)).toEqual(['DRY_RUN', 'SKIPPED']);
    expect(rows[1].reason).toMatch(/^Cooldown/);
    expect(statusOf('dry')).toBe('ACTIVE');
    await stack.waitFor(async () => (await notificationsOf('Preview')).length === 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(await notificationsOf('Preview')).toHaveLength(1);
  });

  it('a run whose lease was taken over stops before acting and leaves the new lease alone', async () => {
    const created = await createRule({ name: 'Fenced', scope: { adAccountIds: [usdAccountId], nameContains: 'fenced' } });
    stack.meta.inject({ match: new RegExp(`^GET /act_${usdMeta}/insights$`), times: 1, kind: 'delay', delayMs: 1500 });
    const running = engine().run(created.id, { manual: true });
    await stack.waitFor(async () => (await stack.prisma.autoRule.findUniqueOrThrow({ where: { id: created.id } })).leaseOwner);
    // Meanwhile the lease expired and another worker took the rule over.
    await stack.prisma.autoRule.update({ where: { id: created.id }, data: { leaseOwner: 'other-worker:run', leaseExpiresAt: new Date(Date.now() + 10 * 60_000) } });
    const summary = await running;
    expect(summary).toMatchObject({ matched: 1, acted: 0 });
    expect(statusOf('fenced')).toBe('ACTIVE');
    expect(posts('fenced')).toBe(0);
    expect(await executions(created.id)).toHaveLength(0);
    expect(await stack.prisma.autoRule.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ leaseOwner: 'other-worker:run', lastRunAt: null });
    await stack.prisma.autoRule.update({ where: { id: created.id }, data: { leaseOwner: null, leaseExpiresAt: null } });
  });

  it('an ad account whose metrics fail neither stops the others nor loses the summary', async () => {
    const created = await createRule({
      name: 'Two accounts',
      conditions: [{ metric: 'impressions', operator: 'gte', value: '100' }],
      scope: { adAccountIds: [usdAccountId, plnAccountId], nameContains: 'partial' },
    });
    stack.meta.inject({
      match: new RegExp(`^GET /act_${usdMeta}/insights$`),
      times: 1,
      kind: 'error',
      status: 400,
      error: { message: '(#100) Invalid parameter', type: 'OAuthException', code: 100, fbtrace_id: 'Atest' },
    });
    // The run still fails (the job is retried) after the other account was handled and reported.
    await expect(engine().run(created.id, { manual: true })).rejects.toThrow();
    expect(statusOf('partial-pln')).toBe('PAUSED');
    expect(statusOf('partial-usd')).toBe('ACTIVE');
    await stack.waitFor(async () => (await notificationsOf('Two accounts')).length === 1);
    expect((await notificationsOf('Two accounts'))[0].title).toMatch(/acted on 1 object/);
    const saved = await stack.prisma.autoRule.findUniqueOrThrow({ where: { id: created.id } });
    expect(saved.lastRunStatus).toBe('PARTIAL');
    expect(saved.lastRunError).toMatch(/^Joint EU USD: /);
    expect(saved.leaseOwner).toBeNull();
  });

  it('a re-run claimed again within the same minute is not dropped as a duplicate job', async () => {
    const created = await createRule({ name: 'Scheduled', isActive: true, action: 'NOTIFY_ONLY', scope: { adAccountIds: [usdAccountId], nameContains: 'nothing matches this' } });
    const lastRunAt = async () => (await stack.prisma.autoRule.findUniqueOrThrow({ where: { id: created.id } })).lastRunAt;
    await stack.prisma.autoRule.update({ where: { id: created.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });
    await stack.runTask(AutoRulesTask);
    const first = await stack.waitFor(lastRunAt);
    // E.g. the engine deferred the run by a few seconds (rate limit): it is due again right away.
    await stack.prisma.autoRule.update({ where: { id: created.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });
    await stack.runTask(AutoRulesTask);
    await stack.waitFor(async () => ((await lastRunAt())?.getTime() ?? 0) > first.getTime());
  });

  it('manual budget changes: idempotent with an Idempotency-Key, locked against rules, clear errors', async () => {
    const id = (await stack.prisma.adSet.findFirstOrThrow({ where: { metaAdSetId: sets.manual } })).id;
    const change = (body: Record<string, unknown>, key?: string) =>
      user.client.post('/api/campaigns/actions/budget', { level: 'ADSET', id, ...body }, key ? { 'Idempotency-Key': key } : undefined);

    // A retry (e.g. after a timeout) returns the first result instead of adding another 10 %.
    const first = expectStatus(await change({ mode: 'INCREASE_PCT', value: '10' }, 'budget-key-0001'), 200).body;
    expect(first).toEqual({ field: 'daily_budget', before: '40.00', after: '44.00', currency: 'USD' });
    expect(expectStatus(await change({ mode: 'INCREASE_PCT', value: '10' }, 'budget-key-0001'), 200).body).toEqual(first);
    expect(budgetOf('manual')).toBe('4400');
    expect(posts('manual')).toBe(1);
    expect((await change({ mode: 'INCREASE_PCT', value: '15' }, 'budget-key-0001')).status).toBe(422);
    expect((await change({ mode: 'INCREASE_PCT', value: '10' }, 'short')).status).toBe(400);

    // A request that changed nothing does not use up its key (confirming a large change reuses it).
    expect((await change({ mode: 'INCREASE_PCT', value: '60' }, 'budget-key-0002')).status).toBe(409);
    expect(expectStatus(await change({ mode: 'INCREASE_PCT', value: '60', confirmLargeChange: true }, 'budget-key-0002'), 200).body.after).toBe('70.40');

    // Amounts the currency cannot express, or out-of-range percentages, are a 400 (was a 500).
    const cents = await change({ mode: 'SET', value: '12.345' });
    expect(cents.status).toBe(400);
    expect(cents.body.error.details).toEqual([{ path: 'value', message: 'Use at most 2 decimals' }]);
    expect((await change({ mode: 'INCREASE_PCT', value: '1234567', confirmLargeChange: true })).status).toBe(400);

    // While an automated rule (or another tab) holds the object's lock, the change is refused instead of racing it.
    const locks = stack.api.get(LockService);
    const lock = (await locks.acquire(entityLockName(sets.manual), 60_000))!;
    expect((await change({ mode: 'SET', value: '50' })).status).toBe(409);
    await locks.release(lock);

    // Failing to read the live budget happens before anything is sent: the key can be used again.
    stack.meta.inject({ match: new RegExp(`^GET /${sets.manual}$`), times: 3, kind: 'drop-after-process' });
    expect((await change({ mode: 'SET', value: '50' }, 'budget-key-0003')).status).toBe(422);
    expect(expectStatus(await change({ mode: 'SET', value: '50' }, 'budget-key-0003'), 200).body.after).toBe('50.00');

    // No answer to the change itself: the result is unknown, so the same key is never applied again.
    stack.meta.inject({ match: new RegExp(`^POST /${sets.manual}$`), times: 3, kind: 'drop-after-process' });
    expect((await change({ mode: 'INCREASE_PCT', value: '10' }, 'budget-key-0004')).status).toBe(422);
    const sent = posts('manual');
    const replay = await change({ mode: 'INCREASE_PCT', value: '10' }, 'budget-key-0004');
    expect(replay.status).toBe(409);
    expect(replay.body.error.message).toMatch(/result is unknown/);
    expect(posts('manual')).toBe(sent);
    expect(budgetOf('manual')).toBe('5500');
  });
});
