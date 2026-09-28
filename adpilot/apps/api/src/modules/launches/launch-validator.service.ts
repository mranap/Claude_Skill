import { Injectable } from '@nestjs/common';
import {
  AD_ACCOUNT_STATUS_DISPLAY,
  goalRule,
  launchConfigSchema,
  majorToMinor,
  minorToMajor,
  targetsEu,
  type LaunchConfig,
  type Variant,
} from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { LaunchContext, ValidationIssue, ValidationResult } from './launch.types';

const LEAD_FORM_CTAS = new Set(['LEARN_MORE', 'SIGN_UP', 'APPLY_NOW', 'GET_QUOTE', 'SUBSCRIBE', 'DOWNLOAD', 'BOOK_NOW', 'CONTACT_US', 'GET_OFFER']);
const SPECIAL_RESTRICTED = new Set(['HOUSING', 'EMPLOYMENT', 'FINANCIAL_PRODUCTS_SERVICES']);
const MAX_ADSETS = 50;
const MAX_ADS = 250;

/**
 * Local validation before anything is sent to Meta (the plan builder only runs on a valid context).
 * Everything that Meta would reject for configuration reasons is checked here with a clear message:
 * objective/destination/goal/billing compatibility, promoted object, lead form, budgets vs the account
 * minimum, bid strategy inputs, lifetime schedule, targeting rules, special ad categories, EU DSA fields,
 * creative ownership/readiness/format, links and text lengths.
 */
@Injectable()
export class LaunchValidatorService {
  constructor(private readonly prisma: PrismaService) {}

  async validate(userId: string, raw: unknown): Promise<ValidationResult & { context?: LaunchContext }> {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const parsed = launchConfigSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        warnings,
      };
    }
    const config = parsed.data;
    const s = config.settings;
    const err = (path: string, message: string) => errors.push({ path, message });
    const warn = (path: string, message: string) => warnings.push({ path, message });

    // ── References (ownership enforced by userId in every query) ──
    const profile = await this.prisma.metaProfile.findFirst({ where: { id: config.profileId, userId, deletedAt: null }, include: { proxy: true } });
    if (!profile) err('profileId', 'Meta profile not found');
    else if (!profile.isEnabled) err('profileId', 'This Meta profile is disabled');
    else if (profile.status !== 'ACTIVE') err('profileId', `The token of this Meta profile is not active (${profile.status}). Fix the token first.`);

    const adAccount = await this.prisma.adAccount.findFirst({ where: { id: config.adAccountId, userId } });
    if (!adAccount) err('adAccountId', 'Ad account not found');
    else {
      if (profile && adAccount.profileId !== profile.id) err('adAccountId', 'This ad account belongs to another Meta profile');
      if (!adAccount.isConnected) err('adAccountId', 'Connect this ad account first');
      if (['DISABLED', 'CLOSED', 'PENDING_CLOSURE', 'ANY_CLOSED'].includes(adAccount.statusKey)) {
        err('adAccountId', `The ad account is ${AD_ACCOUNT_STATUS_DISPLAY[adAccount.statusKey].label.toLowerCase()} and cannot run ads`);
      } else if (adAccount.statusKey !== 'ACTIVE' && adAccount.statusKey !== 'ANY_ACTIVE') {
        warn('adAccountId', `The ad account status is "${AD_ACCOUNT_STATUS_DISPLAY[adAccount.statusKey].label}". Ads may not deliver until it is resolved.`);
      }
    }
    const currency = adAccount?.currency ?? 'USD';

    // ── Objective / destination / goal / billing ──
    const rule = goalRule(s.objective, s.destination, s.optimizationGoal);
    if (!rule) {
      err('settings.optimizationGoal', 'This optimization goal is not available for the selected objective and conversion location');
    } else {
      if (!rule.billingEvents.includes(s.billingEvent)) err('settings.billingEvent', `Choose one of: ${rule.billingEvents.join(', ')}`);
      if (rule.promotedObject === 'PIXEL_EVENT') {
        if (!s.conversion.pixelId) err('settings.conversion.pixelId', 'This optimization goal requires a Pixel / dataset');
        if (!s.conversion.event) err('settings.conversion.event', 'Select the conversion event to optimise for');
        else if (rule.events && !rule.events.includes(s.conversion.event)) err('settings.conversion.event', `Allowed events: ${rule.events.join(', ')}`);
      }
      if (rule.requiresVideo && s.creative.format !== 'SINGLE_VIDEO') err('settings.creative.format', 'ThruPlay optimisation requires video ads');
    }

    let pixel = null;
    if (s.conversion.pixelId && adAccount) {
      pixel = await this.prisma.pixel.findFirst({ where: { adAccountId: adAccount.id, metaPixelId: s.conversion.pixelId } });
      if (!pixel) err('settings.conversion.pixelId', 'This Pixel is not shared with the selected ad account (sync the profile if it was added recently)');
      else if (pixel.isUnavailable) warn('settings.conversion.pixelId', 'Meta reports this Pixel as unavailable');
    }

    // ── Identity ──
    let page = null;
    if (!s.identity.pageId) err('settings.identity.pageId', 'Select the Facebook Page the ads will be published from');
    else if (profile) {
      page = await this.prisma.page.findFirst({ where: { profileId: profile.id, userId, metaPageId: s.identity.pageId } });
      if (!page) warn('settings.identity.pageId', 'This Page is not in the synced list of the profile; Meta will verify access when the creative is created');
    }

    // ── Budget & bidding ──
    const budget = s.budget;
    const toMinor = (amount: string, path: string): bigint | null => {
      try {
        const v = majorToMinor(amount, currency);
        if (v <= 0n) {
          err(path, 'The amount must be greater than zero');
          return null;
        }
        return v;
      } catch (e) {
        err(path, (e as Error).message);
        return null;
      }
    };
    const minDaily = adAccount?.minDailyBudget ?? null;
    const checkMinimum = (value: bigint | null, path: string) => {
      if (value !== null && budget.type === 'DAILY' && minDaily && value < minDaily) {
        err(path, `The daily budget is below the minimum for this ad account (${minorToMajor(minDaily, currency)} ${currency})`);
      }
    };
    if (budget.level === 'CAMPAIGN') {
      checkMinimum(toMinor(budget.amount, 'settings.budget.amount'), 'settings.budget.amount');
      if (budget.budgetSharing) warn('settings.budget.budgetSharing', 'Budget sharing only applies to ad set budgets and will be ignored');
      config.variants.forEach((v, i) => {
        if (v.budgetAmount) warn(`variants.${i}.budgetAmount`, 'With a campaign budget, per-group budgets are ignored');
      });
    } else {
      config.variants.forEach((v, i) => {
        const path = v.budgetAmount ? `variants.${i}.budgetAmount` : 'settings.budget.amount';
        checkMinimum(toMinor(v.budgetAmount ?? budget.amount, path), path);
      });
    }
    if ((budget.bidStrategy === 'COST_CAP' || budget.bidStrategy === 'LOWEST_COST_WITH_BID_CAP') && !budget.bidAmount) {
      err('settings.budget.bidAmount', 'Enter the cost per result goal / bid cap');
    }
    if (budget.bidAmount) toMinor(budget.bidAmount, 'settings.budget.bidAmount');
    if (budget.bidStrategy === 'LOWEST_COST_WITH_MIN_ROAS') {
      if (!budget.roasFloor) err('settings.budget.roasFloor', 'Enter the minimum ROAS');
      if (s.optimizationGoal !== 'VALUE') err('settings.budget.bidStrategy', 'A ROAS goal requires the "Maximise value of conversions" optimisation');
    }
    if (budget.spendCap) toMinor(budget.spendCap, 'settings.budget.spendCap');

    // ── Schedule ──
    const start = s.schedule.startTime ? new Date(s.schedule.startTime) : new Date();
    if (s.schedule.startTime && start.getTime() < Date.now() - 5 * 60_000) warn('settings.schedule.startTime', 'The start time is in the past; delivery starts immediately');
    if (budget.type === 'LIFETIME' && !s.schedule.endTime) err('settings.schedule.endTime', 'A lifetime budget requires an end date');
    if (s.schedule.endTime) {
      const end = new Date(s.schedule.endTime);
      if (end.getTime() <= Math.max(start.getTime(), Date.now()) + 3600_000) err('settings.schedule.endTime', 'The end must be at least 1 hour after the start');
    }

    // ── Targeting ──
    const t = s.targeting;
    const special = s.specialAdCategories;
    const restricted = special.some((c) => SPECIAL_RESTRICTED.has(c));
    const allCountries = new Set<string>();
    if (config.variants.length > MAX_ADSETS) err('variants', `At most ${MAX_ADSETS} language/geo groups per launch`);
    const totalAds = config.variants.reduce((n, v) => n + v.ads.length, 0);
    if (totalAds > MAX_ADS) err('variants', `At most ${MAX_ADS} ads per launch`);
    const variantKeys = new Set<string>();
    config.variants.forEach((v, i) => {
      if (variantKeys.has(v.key)) err(`variants.${i}.key`, 'Duplicate group key');
      variantKeys.add(v.key);
      const countries = v.countries.length ? v.countries : t.countries;
      if (!countries.length) err(`variants.${i}.countries`, `Select at least one country for "${v.label}"`);
      countries.forEach((c) => allCountries.add(c));
      const ageMin = v.ageMin ?? t.ageMin;
      const ageMax = v.ageMax ?? t.ageMax;
      if (ageMin > ageMax) err(`variants.${i}.ageMin`, 'Minimum age is greater than maximum age');
      if (restricted && (ageMin !== 18 || ageMax !== 65 || (v.genders ?? t.genders) !== 'ALL')) {
        err(`variants.${i}`, 'Housing, employment and financial products ads must target ages 18–65+ and all genders');
      }
      if (!v.ads.length) err(`variants.${i}.ads`, `Add at least one ad to "${v.label}"`);
      this.validateAds(v, i, config, errors, warnings);
    });
    if (restricted && (t.interests.length || t.excludedCustomAudienceIds.length)) {
      warn('settings.targeting', 'Special ad categories limit detailed targeting options; Meta may reject some criteria');
    }
    if (t.advantageAudience && (t.ageMax < 65 || t.genders !== 'ALL' || t.interests.length)) {
      warn('settings.targeting.advantageAudience', 'With Advantage+ audience, age max, gender and interests are used as suggestions; only the minimum age and locations are strict');
    }
    if (special.length && !s.specialAdCategoryCountries.length) {
      warn('settings.specialAdCategoryCountries', 'Special ad category countries will default to the targeted countries');
    }
    if (adAccount && (t.customAudienceIds.length || t.excludedCustomAudienceIds.length)) {
      const ids = [...t.customAudienceIds, ...t.excludedCustomAudienceIds];
      const found = await this.prisma.customAudience.count({ where: { adAccountId: adAccount.id, metaAudienceId: { in: ids } } });
      if (found !== new Set(ids).size) err('settings.targeting.customAudienceIds', 'Some custom audiences do not belong to this ad account');
    }

    // ── EU Digital Services Act ──
    if (targetsEu([...allCountries])) {
      const beneficiary = s.dsa.beneficiary || adAccount?.defaultDsaBeneficiary;
      const payor = s.dsa.payor || adAccount?.defaultDsaPayor;
      if (!beneficiary || !payor) {
        err('settings.dsa', 'Ads delivered in the EU must state who benefits from and who pays for them (Digital Services Act). Fill in beneficiary and payer.');
      }
    }

    // ── Creatives ──
    const creativeIds = new Set<string>();
    for (const v of config.variants) for (const ad of v.ads) {
      if (ad.creativeFileId) creativeIds.add(ad.creativeFileId);
      for (const c of ad.cards) creativeIds.add(c.creativeFileId);
    }
    const files = await this.prisma.creativeFile.findMany({ where: { id: { in: [...creativeIds] }, userId, deletedAt: null } });
    const creatives = new Map(files.map((f) => [f.id, f]));
    config.variants.forEach((v, i) =>
      v.ads.forEach((ad, j) => {
        const path = `variants.${i}.ads.${j}`;
        const check = (id: string, p: string, expected?: 'IMAGE' | 'VIDEO') => {
          const f = creatives.get(id);
          if (!f) return err(p, 'Creative not found in your library');
          if (f.status !== 'READY') return err(p, `Creative "${f.originalName}" is not ready`);
          if (expected && f.type !== expected) err(p, `"${f.originalName}" is ${f.type === 'VIDEO' ? 'a video' : 'an image'}; this format needs ${expected === 'VIDEO' ? 'a video' : 'an image'}`);
        };
        if (s.creative.format === 'CAROUSEL') ad.cards.forEach((c, k) => check(c.creativeFileId, `${path}.cards.${k}.creativeFileId`));
        else if (ad.creativeFileId) check(ad.creativeFileId, `${path}.creativeFileId`, s.creative.format === 'SINGLE_VIDEO' ? 'VIDEO' : 'IMAGE');
      }),
    );

    // Lead forms
    if (rule?.requiresLeadForm) {
      config.variants.forEach((v, i) =>
        v.ads.forEach((ad, j) => {
          if (!(ad.leadFormId ?? s.creative.leadFormId)) err(`variants.${i}.ads.${j}.leadFormId`, 'Instant form ads need a lead form id');
          const cta = ad.callToAction ?? s.creative.callToAction;
          if (!LEAD_FORM_CTAS.has(cta)) err(`variants.${i}.ads.${j}.callToAction`, `"${cta}" cannot be used with Instant forms`);
        }),
      );
    }

    const ok = errors.length === 0;
    return {
      ok,
      errors,
      warnings,
      context: ok && profile && adAccount ? { config, profile, adAccount, page, pixel, creatives } : undefined,
    };
  }

  private validateAds(v: Variant, i: number, config: LaunchConfig, errors: ValidationIssue[], warnings: ValidationIssue[]) {
    const s = config.settings;
    const keys = new Set<string>();
    const needsLink = s.destination === 'WEBSITE';
    v.ads.forEach((ad, j) => {
      const path = `variants.${i}.ads.${j}`;
      if (keys.has(ad.key)) errors.push({ path: `${path}.key`, message: 'Duplicate ad key' });
      keys.add(ad.key);
      if (s.creative.format === 'CAROUSEL') {
        if (ad.cards.length < 2) errors.push({ path: `${path}.cards`, message: 'A carousel needs 2–10 cards' });
        if (needsLink && !ad.link && ad.cards.some((c) => !c.link)) errors.push({ path: `${path}.link`, message: 'Enter the website URL (or one per card)' });
      } else if (!ad.creativeFileId) {
        errors.push({ path: `${path}.creativeFileId`, message: 'Select a creative' });
      }
      if (needsLink && s.creative.format !== 'CAROUSEL' && !ad.link) errors.push({ path: `${path}.link`, message: 'Enter the website URL' });
      if (ad.primaryText.length > 125) warnings.push({ path: `${path}.primaryText`, message: 'Primary text longer than 125 characters is truncated in most placements' });
      if (ad.headline && ad.headline.length > 40) warnings.push({ path: `${path}.headline`, message: 'Headlines longer than 40 characters may be truncated' });
      if (!ad.headline && s.creative.format !== 'CAROUSEL') warnings.push({ path: `${path}.headline`, message: 'No headline set' });
    });
  }
}
