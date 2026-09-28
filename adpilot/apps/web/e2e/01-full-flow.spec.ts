import { Cleanup, apiOk, expectToast, idFromUrl, runStamp, signIn } from './support/app';
import { env, missingEnv } from './support/env';
import { generateMedia, hasFfmpeg, type TestMedia } from './support/media';
import { PROFILE_PREFIX, deleteProfileNamed, removeSuiteProfiles, tokenHolder } from './support/meta';
import { expect, test } from './support/test';

/**
 * The main journey against the Meta emulator: profile → discovery → connected ad accounts → creatives →
 * template → launch wizard (dry run, launch until every object exists) → campaigns (start, bulk pause) →
 * statistics → automated rule (dry run, run now, history, cooldown). The tests build on each other.
 */
const missing = missingEnv('admin', 'meta');
const stamp = runStamp();
const names = {
  profile: `${PROFILE_PREFIX} ${stamp}`,
  template: `E2E leads ${stamp}`,
  launch: `E2E launch ${stamp}`,
  rule: `E2E pause ${stamp}`,
};
const cleanup = new Cleanup();
let media: TestMedia | undefined;
let templateId = '';
let launchPath = '';
let campaignName = '';

test.describe.serial('full flow on the Meta emulator', () => {
  test.skip(!!missing, missing);
  test.skip(!missing && !hasFfmpeg(), 'ffmpeg is needed to generate the test media (or set FFMPEG_PATH).');

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test.afterAll(async () => {
    media?.cleanup();
    await cleanup.run();
  });

  test('adds a profile with the emulator token and connects the discovered ad accounts', async ({ page }) => {
    await test.step('remove the profiles of earlier runs', () => removeSuiteProfiles(page));

    await test.step('add the profile after a successful connection test', async () => {
      await page.goto('/meta-profiles');
      await page
        .getByRole('button', { name: /Add (your first )?profile/ })
        .first()
        .click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('textbox', { name: 'Profile name', exact: true }).fill(names.profile);
      await dialog.getByLabel('Access token').fill(env.metaToken);
      await dialog.getByRole('button', { name: 'Test connection' }).click();
      await expect(dialog.getByTestId('token-inspection')).toBeVisible();
      await dialog.getByRole('button', { name: 'Add profile' }).click();

      // A token can be in one profile only. When another profile still holds the emulator token (manual
      // testing), the dialog names it: remove that profile and save again.
      const profileUrl = /\/meta-profiles\/[0-9a-f-]{36}$/;
      const conflict = dialog.getByRole('alert').filter({ hasText: 'already connected in the profile' });
      const outcome = await Promise.race([
        page.waitForURL(profileUrl).then(() => 'created' as const),
        conflict.waitFor().then(() => 'conflict' as const),
      ]);
      if (outcome === 'conflict') {
        const holder = tokenHolder(await conflict.innerText());
        expect(holder, 'profile that holds the emulator token').toBeTruthy();
        await deleteProfileNamed(page, holder as string);
        await dialog.getByRole('button', { name: 'Add profile' }).click();
        await page.waitForURL(profileUrl);
      }
      await expect(page.getByRole('heading', { name: names.profile })).toBeVisible();
    });

    await test.step('discovery lists the ad accounts', async () => {
      const tab = page.getByRole('tab', { name: /^Ad accounts \(\d+\)/ });
      // the emulator seeds two ad accounts (USD and PLN)
      await expect
        .poll(async () => Number(/\((\d+)\)/.exec(await tab.innerText())?.[1] ?? 0), { timeout: 60_000 })
        .toBeGreaterThanOrEqual(2);
    });

    await test.step('connect every discovered ad account', async () => {
      const boxes = await page.getByRole('checkbox', { name: /^Connect / }).all();
      for (const box of boxes) await box.check();
      await page.getByRole('button', { name: 'Save connections' }).click();
      await expectToast(page, 'connected');
      await expect(page.getByText(`${boxes.length} connected of ${boxes.length}`)).toBeVisible();
    });
  });

  test('uploads an image and a video to the creative library', async ({ page }) => {
    media = generateMedia(stamp);
    cleanup.add('delete the uploaded creatives', async (admin) => {
      const list = await apiOk<{ items: { id: string; name: string }[] }>(
        admin,
        'GET',
        `/creatives?q=${stamp}&pageSize=50`,
      );
      for (const creative of list.items) {
        if (creative.name.includes(stamp)) await apiOk(admin, 'DELETE', `/creatives/${creative.id}`);
      }
    });

    await page.goto('/creatives');
    await page.getByTestId('creative-file-input').setInputFiles([media.image, media.video]);
    const rows = page.getByTestId('upload-row');
    const finished = ['done', 'duplicate', 'error', 'cancelled'];
    await expect
      .poll(
        async () => {
          const statuses = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-status')));
          return statuses.length === 2 && statuses.every((s) => finished.includes(s ?? ''));
        },
        { message: 'both uploads finish', timeout: 90_000 },
      )
      .toBe(true);
    // new files (a random colour each run): processed, not matched as duplicates of earlier uploads
    await expect(rows.and(page.locator('[data-status="done"]'))).toHaveCount(2);
  });

  test('creates a launch template', async ({ page }) => {
    await page.goto('/templates/new');
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(names.template);
    await expect(page.locator('#assets-account')).not.toHaveAttribute('data-placeholder');
    await page.locator('#assets-account').click();
    await page.getByRole('option', { name: /USD/ }).first().click();
    await page
      .getByRole('combobox', { name: /Countries/ })
      .first()
      .click();
    await page.getByPlaceholder('Search countries or type EU').fill('Poland');
    await page.getByRole('option', { name: /Poland/ }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('combobox', { name: /Pixel/ }).click();
    await page.getByRole('option').first().click();
    await page.getByRole('combobox', { name: /Conversion event/ }).click();
    await page.getByRole('option', { name: 'Lead', exact: true }).click();
    await page.getByRole('combobox', { name: /Facebook Page/ }).click();
    await page.getByRole('option').first().click();
    await page.getByRole('button', { name: 'Create template' }).first().click();
    await expectToast(page, 'Template created');
    await page.waitForURL(/\/templates\/[0-9a-f-]{36}$/);
    templateId = idFromUrl(page);
    // used by the launch: the API archives it instead of deleting it
    cleanup.add('archive the template', (admin) => apiOk(admin, 'DELETE', `/templates/${templateId}`));
  });

  test('launches from the template after a dry run until every object exists', async ({ page }) => {
    test.setTimeout(5 * 60_000);
    const next = () => page.getByRole('button', { name: 'Next', exact: true }).click();

    await page.goto(`/launch/new?template=${templateId}`);
    await page.waitForURL(/\/launch\/[0-9a-f-]{36}$/);

    await test.step('ad account', async () => {
      await page.getByRole('combobox', { name: /Meta profile/ }).click();
      await page.getByRole('option', { name: names.profile }).click();
      await page.getByRole('combobox', { name: /Ad account/ }).click();
      await page.getByRole('option', { name: /USD/ }).first().click();
      await next();
    });

    await test.step('template, campaign and ad set settings', async () => {
      await page.getByRole('textbox', { name: 'Launch name' }).fill(names.launch);
      await next();
      await expect(page.getByRole('heading', { name: 'Budget & bidding' })).toBeVisible();
      await next();
      await expect(page.getByRole('heading', { name: 'Placements' })).toBeVisible();
      await next();
    });

    await test.step('language / geo group', async () => {
      await expect(page.getByRole('heading', { name: 'Language / geo groups' })).toBeVisible();
      if (!(await page.getByTestId('variant-card').count())) {
        await page.getByRole('button', { name: 'Add group' }).first().click();
      }
      await page.getByRole('textbox', { name: 'Name of group 1' }).fill('Poland');
      await next();
    });

    await test.step('ad with the uploaded video', async () => {
      await expect(page.getByRole('heading', { name: 'Ad format & creative options' })).toBeVisible();
      await page.getByRole('button', { name: 'Add ad' }).first().click();
      await page.getByRole('button', { name: 'Video', exact: true }).click();
      const picker = page.getByRole('dialog');
      await picker.getByRole('button', { name: new RegExp(`e2e-story-${stamp}`) }).click();
      await picker.getByRole('button', { name: 'Use selected' }).click();
      await page.getByRole('textbox', { name: 'Primary text' }).fill('Book a free consultation today.');
      await page.getByRole('textbox', { name: 'Headline' }).fill('Free consultation');
      await page.getByRole('textbox', { name: 'Website URL' }).fill('https://example.com/lp');
      await next();
    });

    await test.step('naming and EU transparency (DSA)', async () => {
      await expect(page.getByRole('heading', { name: 'EU transparency (DSA)' })).toBeVisible();
      await page.getByRole('textbox', { name: 'Beneficiary' }).fill('Example Sp. z o.o.');
      await page.getByRole('textbox', { name: 'Payer' }).fill('Example Sp. z o.o.');
      await next();
    });

    await test.step('review: the dry run passes and shows the payloads', async () => {
      await expect(page.getByRole('heading', { name: 'Check before launching' })).toBeVisible();
      const verdict = page.getByText(/^Ready to launch$|problems? blocks?/).first();
      await expect(verdict).toBeVisible({ timeout: 60_000 });
      await expect(verdict, 'validation problems (see the screenshot)').toHaveText('Ready to launch');
      const payloads = page.getByRole('button', { name: /Show payload/ });
      // media upload, campaign, ad set, creative and ad
      await expect.poll(() => payloads.count()).toBeGreaterThanOrEqual(4);
      await page
        .getByRole('button', { name: /Campaign.*Show payload/ })
        .first()
        .click();
      await expect(page.locator('pre').filter({ hasText: '"objective"' }).first()).toBeVisible();
      await page.getByRole('button', { name: 'Continue to launch' }).click();
    });

    await test.step('launch and wait for COMPLETED', async () => {
      await page.getByTestId('launch-now').click();
      await page.waitForURL(/\/launches\/[0-9a-f-]{36}$/, { timeout: 30_000 });
      launchPath = new URL(page.url()).pathname;
      const outcome = page.getByText(
        /^(All objects were created|The launch was cancelled|The launch stopped with errors)$/,
      );
      await expect(outcome).toBeVisible({ timeout: 180_000 });
      await expect(outcome).toHaveText('All objects were created');
      const job = await apiOk<{ status: string }>(page, 'GET', `/launches/${idFromUrl(page)}`);
      expect(job.status).toBe('COMPLETED');
    });
  });

  test('lists the campaign, starts it and pauses it with a bulk action', async ({ page }) => {
    await test.step('the launched campaign is in the campaigns table', async () => {
      await page.goto(launchPath);
      await page.getByRole('link', { name: 'View campaign' }).click();
      await page.waitForURL(/\/campaigns\?q=\d+/);
      const link = page.getByRole('table', { name: 'Campaigns' }).getByRole('link').first();
      await expect(link).toBeVisible();
      campaignName = (await link.innerText()).trim();
    });

    await test.step('start it with the inline switch', async () => {
      const start = page.getByRole('switch', { name: `Start campaign ${campaignName}` });
      if (await start.count()) {
        await start.click();
        await page.getByRole('alertdialog').getByRole('button', { name: 'Start', exact: true }).click();
        await expectToast(page, /Campaign (started|was already active)/);
      }
      await expect(page.getByRole('switch', { name: `Pause campaign ${campaignName}` })).toBeVisible();
    });

    await test.step('pause it with a bulk action and follow the progress', async () => {
      await page
        .getByRole('row')
        .filter({ hasText: campaignName })
        .getByRole('checkbox', { name: 'Select row' })
        .check();
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog.getByText(campaignName)).toBeVisible();
      await dialog.getByRole('button', { name: 'Pause 1 campaign' }).click();
      await expect(page.getByTestId('bulk-operation').getByText(/Paused 1 of 1 campaign/)).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByRole('switch', { name: `Start campaign ${campaignName}` })).toBeVisible();
    });

    await test.step('the detail page shows ad sets, ads and the paused state', async () => {
      await page.getByRole('link', { name: campaignName }).first().click();
      await page.waitForURL(/\/campaigns\/[0-9a-f-]{36}/);
      await expect(page.getByRole('table', { name: 'Ad sets' })).toBeVisible();
      await expect(page.getByRole('table', { name: 'Ads' })).toBeVisible();
      await expect(page.getByText(/paused/i).first()).toBeVisible();
    });
  });

  test('shows statistics with totals, a daily chart and the refresh cooldown', async ({ page }) => {
    await page.goto('/statistics?range=last_7d');
    await expect(page.getByText(/Totals in [A-Z]{3}/).first()).toBeVisible({ timeout: 30_000 });
    const box = await page
      .getByRole('img', { name: /per day in/ })
      .first()
      .boundingBox();
    if (!box) throw new Error('The daily chart is not rendered');
    // hovering a day shows its values
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
    await expect(page.getByRole('status').filter({ hasText: /\d/ }).first()).toBeVisible();
    const refresh = page.getByRole('button', { name: 'Refresh all' });
    if (await refresh.isVisible()) await refresh.click();
    // right after a refresh (here or in an earlier run) the button counts down to the next allowed one
    await expect(page.getByText(/Again in \d+:\d\d/).first()).toBeVisible();
  });

  test('runs a dry-run rule manually and records the execution', async ({ page }) => {
    let rulePath = '';
    await test.step('create the rule', async () => {
      await page.goto('/rules/new');
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill(names.rule);
      await page.getByRole('combobox', { name: /Ad accounts/ }).click();
      await page.getByRole('option', { name: /USD/ }).first().click();
      await page.keyboard.press('Escape');
      await page.getByRole('combobox', { name: 'Condition 1 metric' }).click();
      await page.getByRole('option', { name: 'Spend', exact: true }).click();
      await page.getByRole('combobox', { name: 'Condition 1 operator' }).click();
      await page.getByRole('option', { name: '≥', exact: true }).click();
      await page.getByRole('textbox', { name: 'Condition 1 value' }).fill('0');
      await page.getByRole('switch', { name: /Dry run/ }).click();
      await page.getByRole('button', { name: 'Create rule' }).click();
      await page.waitForURL(/\/rules\/[0-9a-f-]{36}$/);
      await expectToast(page, 'Rule created');
      rulePath = new URL(page.url()).pathname;
      const ruleId = idFromUrl(page);
      cleanup.add('delete the rule', (admin) => apiOk(admin, 'DELETE', `/rules/${ruleId}`));
    });

    await test.step('run now starts the one-minute cooldown', async () => {
      await page.getByRole('button', { name: 'Run now' }).click();
      await expectToast(page, 'Rule started');
      await expect(page.getByText(/Again in 0:\d\d/).first()).toBeVisible();
    });

    await test.step('the dry-run execution appears in the history', async () => {
      await page.goto(`${rulePath}?tab=history`);
      const table = page.getByRole('table', { name: 'Rule executions' });
      const dryRun = table.getByText('Dry run', { exact: true }).first();
      await expect(async () => {
        await page.reload();
        await expect(dryRun).toBeVisible({ timeout: 3_000 });
      }).toPass({ timeout: 60_000 });
      await table.getByRole('button', { name: 'Expand row' }).first().click();
      await expect(table.getByText('Outcome').first()).toBeVisible();
      await expect(table.getByText(/· dry run$/).first()).toBeVisible();
    });

    await test.step('reopening the rule within the minute shows the countdown instead of Run now', async () => {
      await page.goto(rulePath);
      await expect(page.getByText(/Again in 0:\d\d/).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Run now' })).toHaveCount(0);
    });
  });
});
