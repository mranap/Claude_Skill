import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { majorToMinor, minorToMajor, PLACEMENT_LABELS } from '@adpilot/shared';
import type { LaunchContext, LaunchPlan, PlanItem, PlanSummary } from './launch.types';
import {
  buildAdPayload,
  buildAdSetPayload,
  buildCampaignPayload,
  buildCreativePayload,
  effectiveCountries,
  renderName,
} from './meta-payloads';

function stripExt(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{2,5}$/, '');
}

/**
 * Turns a validated launch context into an ordered, fully resolved list of Meta objects to create.
 * The same plan is shown in "Dry run" and stored with the launch job, so what the user reviewed is exactly
 * what the worker creates.
 */
@Injectable()
export class PlanBuilderService {
  build(ctx: LaunchContext, code: string): LaunchPlan {
    const { config, adAccount } = ctx;
    const s = config.settings;
    const currency = adAccount.currency;
    const today = DateTime.now().setZone(adAccount.timezoneName).toFormat('yyyy-MM-dd');
    const items: PlanItem[] = [];

    // 1. Media: one upload per distinct library file.
    const mediaKey = (fileId: string) => `media:${fileId}`;
    const usedFiles: string[] = [];
    for (const v of config.variants)
      for (const ad of v.ads) {
        const ids =
          s.creative.format === 'CAROUSEL'
            ? ad.cards.map((c) => c.creativeFileId)
            : ad.creativeFileId
              ? [ad.creativeFileId]
              : [];
        for (const id of ids) if (!usedFiles.includes(id)) usedFiles.push(id);
      }
    for (const id of usedFiles) {
      const f = ctx.creatives.get(id)!;
      items.push({
        key: mediaKey(id),
        kind: f.type === 'VIDEO' ? 'MEDIA_VIDEO' : 'MEDIA_IMAGE',
        name: f.originalName,
        payload: { creativeFileId: id, type: f.type, sizeBytes: f.sizeBytes.toString() },
        creativeFileId: id,
      });
    }

    // 2. Campaign
    const campaignName = renderName(s.naming.campaign, {
      name: config.name,
      date: today,
      code,
      objective: s.objective,
    });
    items.push({
      key: 'campaign',
      kind: 'CAMPAIGN',
      name: campaignName,
      payload: buildCampaignPayload(config, campaignName, currency),
    });

    // 3. Ad sets, 4. creatives + ads
    for (const v of config.variants) {
      const countries = effectiveCountries(s, v);
      const adSetKey = `adset:${v.key}`;
      const adSetName = renderName(s.naming.adSet, {
        name: config.name,
        variant: v.label,
        countries: countries.join(','),
        date: today,
        code,
      });
      items.push({
        key: adSetKey,
        kind: 'ADSET',
        parentKey: 'campaign',
        name: adSetName,
        payload: buildAdSetPayload(config, v, adSetName, currency, {
          dsaBeneficiary: adAccount.defaultDsaBeneficiary,
          dsaPayor: adAccount.defaultDsaPayor,
        }),
      });
      v.ads.forEach((ad, idx) => {
        const firstFile = ad.creativeFileId ?? ad.cards[0]?.creativeFileId;
        const fileName = firstFile ? stripExt(ctx.creatives.get(firstFile)?.originalName ?? '') : '';
        const adName =
          ad.name?.trim() ||
          renderName(s.naming.ad, {
            name: config.name,
            variant: v.label,
            creative: fileName,
            n: idx + 1,
            code,
          });
        const creativeKey = `creative:${v.key}:${ad.key}`;
        items.push({
          key: creativeKey,
          kind: 'CREATIVE',
          parentKey: adSetKey,
          name: `${adName} · creative`,
          payload: buildCreativePayload(config, v, ad, `${adName} · ${code}`, {
            mediaKey,
            typeOf: (id) => (ctx.creatives.get(id)?.type === 'VIDEO' ? 'VIDEO' : 'IMAGE'),
          }),
        });
        items.push({
          key: `ad:${v.key}:${ad.key}`,
          kind: 'AD',
          parentKey: adSetKey,
          name: adName,
          payload: buildAdPayload(adName, adSetKey, creativeKey),
        });
      });
    }

    return {
      version: 1,
      code,
      adAccountMetaId: adAccount.metaAccountId,
      items,
      summary: this.summary(ctx, items),
    };
  }

  private summary(ctx: LaunchContext, items: PlanItem[]): PlanSummary {
    const { config, adAccount } = ctx;
    const s = config.settings;
    const currency = adAccount.currency;
    const perAdSet = config.variants.map((v) => ({
      variant: v.label,
      amount:
        s.budget.level === 'ADSET'
          ? minorToMajor(majorToMinor(v.budgetAmount ?? s.budget.amount, currency), currency)!
          : '—',
    }));
    const total =
      s.budget.level === 'CAMPAIGN'
        ? minorToMajor(majorToMinor(s.budget.amount, currency), currency)!
        : minorToMajor(
            config.variants.reduce(
              (sum, v) => sum + majorToMinor(v.budgetAmount ?? s.budget.amount, currency),
              0n,
            ),
            currency,
          )!;
    const p = s.placements;
    const placements =
      p.mode === 'AUTOMATIC'
        ? 'Advantage+ placements (automatic)'
        : p.publisherPlatforms.map((pp) => PLACEMENT_LABELS[pp] ?? pp).join(', ');
    const t = s.targeting;
    return {
      campaigns: 1,
      adSets: items.filter((i) => i.kind === 'ADSET').length,
      ads: items.filter((i) => i.kind === 'AD').length,
      creatives: items.filter((i) => i.kind === 'CREATIVE').length,
      mediaUploads: items.filter((i) => i.kind === 'MEDIA_IMAGE' || i.kind === 'MEDIA_VIDEO').length,
      currency,
      budget: {
        level: s.budget.level,
        type: s.budget.type,
        campaignAmount: s.budget.level === 'CAMPAIGN' ? total : undefined,
        perAdSet,
        total,
      },
      bidStrategy: s.budget.bidStrategy,
      geos: config.variants.map((v) => ({
        variant: v.label,
        countries: effectiveCountries(s, v),
        locales: (v.locales.length ? v.locales : t.locales).map((l) => l.name),
      })),
      audience: {
        ageMin: t.ageMin,
        ageMax: t.ageMax,
        genders: t.genders,
        advantageAudience: t.advantageAudience,
        customAudiences: t.customAudienceIds.length,
        excludedAudiences: t.excludedCustomAudienceIds.length,
        interests: t.interests.length,
      },
      placements,
      creativeFiles: [...ctx.creatives.values()].map((f) => ({
        creativeFileId: f.id,
        name: f.originalName,
        type: f.type,
      })),
      objective: s.objective,
      optimizationGoal: s.optimizationGoal,
      destination: s.destination,
      activateOnSuccess: s.activateOnSuccess,
    };
  }
}
