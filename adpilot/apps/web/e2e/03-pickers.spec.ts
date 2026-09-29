import type { Page } from '@playwright/test';
import { Cleanup, apiOk, expectToast, idFromUrl, runStamp, signIn } from './support/app';
import { env, missingEnv } from './support/env';
import { ensureEmulatorProfile, usdAccount } from './support/meta';
import { expect, test } from './support/test';

/**
 * Look-up pickers of the template editor and the launch wizard against the Meta emulator: languages (loaded
 * once, filtered locally), interests (debounced search with path and audience size, manual ID), Instant Forms
 * (only active forms selectable) and their fallbacks.
 */
const missing = missingEnv('admin', 'meta');
const stamp = runStamp();
const cleanup = new Cleanup();
let profileName = '';
let templateId = '';

const LEAD_FORMS = /\/api\/ad-accounts\/[^/]+\/pages\/[^/]+\/lead-forms/;
const AD_ACCOUNT_LIST = /\/api\/ad-accounts\?/;

/** Opens the template editor in "Advanced" mode (all settings visible). */
async function openEditor(page: Page, path: string): Promise<void> {
  await page.goto(path);
  const advanced = page.getByRole('radio', { name: 'Advanced' });
  await expect(advanced).toBeVisible();
  if ((await advanced.getAttribute('aria-checked')) !== 'true') await advanced.click();
}

test.describe.serial('targeting pickers and Instant Forms', () => {
  test.skip(!!missing, missing);

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test.afterAll(() => cleanup.run());

  test('template editor: languages, interests and the Instant Form are saved', async ({ page }) => {
    const { profile, accounts } = await ensureEmulatorProfile(page, env.metaToken, stamp);
    profileName = profile.name;
    const account = usdAccount(accounts);
    const localeLoads: string[] = [];
    const interestSearches: string[] = [];
    page.on('requestfinished', (request) => {
      const url = request.url();
      if (url.includes(`/api/ad-accounts/${account.id}/targeting/locales`)) localeLoads.push(url);
      if (url.includes('/targeting/interests')) interestSearches.push(url);
    });

    await test.step('Instant Form destination, country and Page', async () => {
      await openEditor(page, '/templates/new');
      await page.getByRole('textbox', { name: 'Name', exact: true }).fill(`E2E lead ads ${stamp}`);
      await page.locator('#assets-account').click();
      await page.getByRole('option', { name: account.name }).first().click();
      await page.getByRole('radio', { name: /Instant form/ }).click();
      await page
        .getByRole('combobox', { name: /Countries/ })
        .first()
        .click();
      await page.getByPlaceholder('Search countries or type EU').fill('Poland');
      await page.getByRole('option', { name: /Poland/ }).click();
      await page.keyboard.press('Escape');
      await page.getByRole('combobox', { name: /Facebook Page/ }).click();
      await page.getByRole('option', { name: /Joint Care/ }).click();
    });

    await test.step('languages: loaded once, filtered locally, picked as chips', async () => {
      await page.getByRole('combobox', { name: 'Languages' }).click();
      await page.getByPlaceholder('Search languages').fill('eng');
      await page.getByRole('option', { name: /English \(US\)/ }).click();
      await page.getByRole('option', { name: /English \(UK\)/ }).click();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Remove English (UK)' }).click();
      await expect(page.getByRole('button', { name: 'Remove English (US)' })).toBeVisible();
      // development mode may abort and repeat a request while mounting; only finished ones count
      expect(localeLoads, 'finished requests for the language list').toHaveLength(1);
    });

    await test.step('interests: debounced search with path and audience size', async () => {
      await page.getByRole('combobox', { name: /Detailed targeting/ }).click();
      const search = page.getByPlaceholder('Search interests, e.g. yoga');
      await search.fill('y');
      await expect(page.getByText(/Type at least 2 characters/)).toBeVisible();
      await search.pressSequentially('og', { delay: 60 });
      const yoga = page.getByRole('option', { name: /Yoga/ });
      await expect(yoga).toContainText('Fitness and wellness');
      await expect(yoga).toContainText(/\d(\.\d)?[KMB]?–\d/);
      await yoga.click();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Remove Yoga' })).toBeVisible();
      expect(
        interestSearches.filter((u) => /[?&]q=y(&|$)/.test(u)),
        'searches for one character',
      ).toEqual([]);
    });

    await test.step('interests: an ID can be entered manually', async () => {
      await page.getByRole('button', { name: 'Enter an interest ID manually' }).click();
      await page.getByRole('textbox', { name: 'Interest ID' }).fill('6003139266461');
      await page.getByRole('textbox', { name: 'Interest name' }).fill('Movies');
      await page.getByRole('button', { name: 'Add', exact: true }).last().click();
      await expect(page.getByRole('button', { name: 'Remove Movies' })).toBeVisible();
    });

    await test.step('Instant Form: only active forms can be chosen', async () => {
      await page.getByRole('combobox', { name: 'Instant Form' }).click();
      const active = page.getByRole('option', { name: /Free consultation/ });
      const archived = page.getByRole('option', { name: /Spring offer 2025/ });
      await expect(active).toBeEnabled();
      await expect(archived).toBeDisabled();
      await expect(archived).toContainText('Archived');
      await expect(page.getByRole('option', { name: /Removed form/ })).toHaveCount(0);
      await active.click();
    });

    await test.step('saving and reopening keeps the choices', async () => {
      await page.getByRole('button', { name: 'Create template' }).first().click();
      await expectToast(page, 'Template created');
      await page.waitForURL(/\/templates\/[0-9a-f-]{36}$/);
      templateId = idFromUrl(page);
      cleanup.add('delete the template', (admin) => apiOk(admin, 'DELETE', `/templates/${templateId}`));
      await openEditor(page, `/templates/${templateId}`);
      await expect(page.getByRole('button', { name: 'Remove English (US)' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Remove Yoga' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Remove Movies' })).toBeVisible();
      await expect(page.getByRole('combobox', { name: 'Instant Form' })).toContainText('Free consultation');
    });
  });

  test('Instant Forms refused by Meta: explanation and the stored form ID in a text field', async ({
    page,
  }) => {
    await page.route(LEAD_FORMS, (route) =>
      route.fulfill({
        status: 422,
        json: {
          error: {
            code: 'META_PERMISSION_ERROR',
            message:
              'Meta did not return the Instant Forms of this Page. Listing them needs the pages_manage_ads permission on the token and a Page role that can advertise. You can still paste the form ID.',
          },
        },
      }),
    );
    await openEditor(page, `/templates/${templateId}`);
    await expect(page.getByText(/pages_manage_ads/)).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Instant Form' })).toHaveValue(/^\d+$/);
  });

  test('without a connected ad account the searches are disabled with a hint', async ({ page }) => {
    await page.route(AD_ACCOUNT_LIST, (route) =>
      route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 200 } }),
    );
    await openEditor(page, '/templates/new');
    await expect(page.getByText(/Connect an ad account to search languages/)).toBeVisible();
    await expect(page.getByText(/Connect an ad account to search interests/)).toBeVisible();
    await expect(page.getByRole('combobox', { name: /Detailed targeting/ })).toBeDisabled();
  });

  test('launch wizard: an ad can override the Instant Form of the launch', async ({ page }) => {
    const next = () => page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.goto(`/launch/new?template=${templateId}`);
    await page.waitForURL(/\/launch\/[0-9a-f-]{36}$/);
    const draftId = idFromUrl(page);
    cleanup.add('delete the draft', (admin) => apiOk(admin, 'DELETE', `/drafts/${draftId}`));

    await page.getByRole('combobox', { name: /Meta profile/ }).click();
    await page.getByRole('option', { name: profileName }).click();
    await page.getByRole('combobox', { name: /Ad account/ }).click();
    await page.getByRole('option', { name: /USD/ }).first().click();
    await next();
    await page.getByRole('textbox', { name: 'Launch name' }).fill(`E2E lead launch ${stamp}`);
    for (const heading of ['Budget & bidding', 'Placements', 'Language / geo groups']) {
      await next();
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }
    if (!(await page.getByTestId('variant-card').count())) {
      await page.getByRole('button', { name: 'Add group' }).first().click();
    }
    await page.getByRole('textbox', { name: 'Name of group 1' }).fill('Poland');
    await next();

    await expect(page.getByRole('heading', { name: 'Ad format & creative options' })).toBeVisible();
    const forms = page.getByRole('combobox', { name: 'Instant Form' });
    await expect(forms.first(), 'form of the launch (from the template)').toContainText('Free consultation');
    await page.getByRole('button', { name: 'Add ad' }).first().click();
    await page
      .getByRole('button', { name: /More options for this ad/ })
      .first()
      .click();
    await expect(forms.nth(1)).toContainText('Default form of the launch');
    await forms.nth(1).click();
    await page.getByRole('option', { name: /Free consultation/ }).click();
    await expect(forms.nth(1)).toContainText('Free consultation');
  });
});
