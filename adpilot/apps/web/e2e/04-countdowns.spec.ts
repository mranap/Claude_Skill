import { Cleanup, apiOk, expectToast, runStamp, signIn } from './support/app';
import { env, missingEnv } from './support/env';
import { ensureEmulatorProfile, usdAccount } from './support/meta';
import { expect, test } from './support/test';

/**
 * Countdowns that come from the API, so they survive a reload: the statistics refresh cooldown
 * (`sync[].nextManualRefreshAt`), the rule "Run now" cooldown (`nextManualRunAt`) and the Meta rate-limit
 * block on the monitoring page (labels from the API).
 */
const missing = missingEnv('admin');
const stamp = runStamp();
const cleanup = new Cleanup();

test.describe('countdowns from the API', () => {
  test.skip(!!missing, missing);

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test.afterAll(() => cleanup.run());

  test('statistics: the refresh cooldown is shown again after a reload', async ({ page }) => {
    const missingMeta = missingEnv('meta');
    test.skip(!!missingMeta, missingMeta);
    await ensureEmulatorProfile(page, env.metaToken, stamp);

    await page.goto('/statistics');
    await expect(page.getByText(/Totals in|No delivery/).first()).toBeVisible({ timeout: 30_000 });
    const refresh = page.getByRole('button', { name: 'Refresh all' });
    if (await refresh.isVisible()) {
      await refresh.click();
      await expect(page.getByText(/Again in \d+:\d\d/).first()).toBeVisible();
    }
    await page.reload();
    await expect(page.getByText(/Totals in|No delivery/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /Again in \d+:\d\d/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh all' })).toHaveCount(0);
  });

  test('rule: the "Run now" cooldown is shown again after a reload', async ({ page }) => {
    const missingMeta = missingEnv('meta');
    test.skip(!!missingMeta, missingMeta);
    const { accounts } = await ensureEmulatorProfile(page, env.metaToken, stamp);
    const rule = await apiOk<{ id: string }>(page, 'POST', '/rules', {
      name: `E2E countdown ${stamp}`,
      isActive: false,
      isDryRun: true,
      targetLevel: 'CAMPAIGN',
      scope: { adAccountIds: [usdAccount(accounts).id] },
      conditions: [{ metric: 'spend', operator: 'gte', value: '0' }],
      timeRange: 'TODAY',
      action: 'NOTIFY_ONLY',
      notify: false,
    });
    cleanup.add('delete the rule', (admin) => apiOk(admin, 'DELETE', `/rules/${rule.id}`));

    await page.goto(`/rules/${rule.id}`);
    await page.getByRole('button', { name: 'Run now' }).click();
    await expectToast(page, 'Rule started');
    await expect(page.getByText(/Again in (0|1):\d\d/).first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: /Again in 0:\d\d/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run now' })).toHaveCount(0);
  });

  test('monitoring: rate-limit rows show the API label and the block countdown', async ({ page }) => {
    const now = Date.now();
    await page.route('**/api/admin/meta-rate-limits', (route) =>
      route.fulfill({
        json: [
          {
            key: 'acct:1063544559',
            label: 'Ad account Joint EU USD (act_1063544559)',
            state: { pct: 82, blockedUntil: now + 90_000, at: now - 5_000 },
          },
          { key: 'tok:6d36ce5b', state: { pct: 12, blockedUntil: 0, at: now - 20_000 } },
        ],
      }),
    );
    await page.goto('/admin/workers?tab=rate-limits');
    await expect(page.getByText('Ad account Joint EU USD (act_1063544559)')).toBeVisible();
    // rows without a label fall back to a description of the key
    await expect(page.getByText(/Token of Meta profile/)).toBeVisible();
    await expect(page.getByText(/Blocked · \d+:\d\d/)).toBeVisible();
  });
});
