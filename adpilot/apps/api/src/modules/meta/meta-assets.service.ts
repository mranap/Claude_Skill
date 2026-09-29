import { Injectable } from '@nestjs/common';
import { adAccountStatusKey } from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AppLogger } from '../../infra/logger/logger';
import { AccountStatusService, MetaAdAccountData } from '../ad-accounts/account-status.service';
import { MetaConnection, MetaGraphClient } from './graph/meta-graph.client';
import { MetaApiError } from './graph/meta-errors';
import {
  AD_ACCOUNT_FIELDS,
  BUSINESS_FIELDS,
  CUSTOM_AUDIENCE_FIELDS,
  PAGE_FIELDS,
  PIXEL_FIELDS,
  actId,
  toBigIntOrNull,
} from './meta-fields';

interface MetaPage {
  id: string;
  name: string;
  category?: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; username?: string };
}

export interface AssetSyncResult {
  businesses: number;
  adAccounts: number;
  newAdAccounts: number;
  pages: number;
  pixels: number;
  audiences: number;
  warnings: string[];
}

/**
 * Discovers what a token can access: Business portfolios, ad accounts (personal + business owned/client),
 * Pages (own + business + promotable by connected accounts), pixels/datasets and custom audiences of the
 * connected ad accounts. Missing optional permissions (e.g. business_management) produce warnings, not
 * failures.
 */
@Injectable()
export class MetaAssetsService {
  private readonly logger = new AppLogger('MetaAssets');

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: MetaGraphClient,
    private readonly accountStatus: AccountStatusService,
    private readonly settings: SettingsService,
  ) {}

  async syncProfile(profileId: string, userId: string, conn: MetaConnection): Promise<AssetSyncResult> {
    const warnings: string[] = [];
    const optional = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof MetaApiError && (err.category === 'AUTH' || err.category === 'RATE_LIMIT'))
          throw err;
        warnings.push(
          `${label}: ${err instanceof MetaApiError ? err.details.friendlyMessage : (err as Error).message}`,
        );
        return fallback;
      }
    };

    // 1. Businesses (needs business_management)
    const businesses = await optional(
      'Business portfolios',
      () =>
        this.graph.paginate<{ id: string; name: string; verification_status?: string }>(
          conn,
          '/me/businesses',
          { fields: BUSINESS_FIELDS },
          'assets.businesses',
        ),
      [],
    );
    const businessRows = new Map<string, string>();
    for (const b of businesses) {
      const row = await this.prisma.businessAccount.upsert({
        where: { profileId_metaBusinessId: { profileId, metaBusinessId: b.id } },
        create: {
          userId,
          profileId,
          metaBusinessId: b.id,
          name: b.name,
          verificationStatus: b.verification_status ?? null,
        },
        update: { name: b.name, verificationStatus: b.verification_status ?? null, lastSyncedAt: new Date() },
      });
      businessRows.set(b.id, row.id);
    }

    // 2. Ad accounts: /me/adaccounts + business owned/client accounts
    const accounts = new Map<string, MetaAdAccountData>();
    const own = await this.graph.paginate<MetaAdAccountData>(
      conn,
      '/me/adaccounts',
      { fields: AD_ACCOUNT_FIELDS },
      'assets.adaccounts',
    );
    for (const a of own) if (a.account_id) accounts.set(a.account_id, a);
    for (const b of businesses) {
      for (const edge of ['owned_ad_accounts', 'client_ad_accounts'] as const) {
        const list = await optional(
          `${b.name} ${edge.replace(/_/g, ' ')}`,
          () =>
            this.graph.paginate<MetaAdAccountData>(
              conn,
              `/${b.id}/${edge}`,
              { fields: AD_ACCOUNT_FIELDS },
              `assets.${edge}`,
            ),
          [],
        );
        for (const a of list) if (a.account_id && !accounts.has(a.account_id)) accounts.set(a.account_id, a);
      }
    }

    const { defaultIntervalMinutes } = await this.settings.get('accountChecks');
    const { defaultSyncIntervalMinutes } = await this.settings.get('statistics');
    let newAccounts = 0;
    for (const a of accounts.values()) {
      const metaAccountId = a.account_id!;
      const existing = await this.prisma.adAccount.findUnique({
        where: { profileId_metaAccountId: { profileId, metaAccountId } },
      });
      const businessId = a.business?.id ? (businessRows.get(a.business.id) ?? null) : null;
      if (!existing) {
        newAccounts++;
        await this.prisma.adAccount.create({
          data: {
            userId,
            profileId,
            businessId,
            metaAccountId,
            metaBusinessId: a.business?.id ?? null,
            metaBusinessName: a.business?.name ?? null,
            name: a.name ?? metaAccountId,
            currency: a.currency ?? 'USD',
            timezoneName: a.timezone_name ?? 'UTC',
            timezoneOffsetHours: a.timezone_offset_hours_utc ?? null,
            accountStatus: a.account_status ?? null,
            statusKey: adAccountStatusKey(a.account_status),
            disableReason: a.disable_reason ?? null,
            amountSpent: toBigIntOrNull(a.amount_spent),
            balance: toBigIntOrNull(a.balance),
            spendCap: toBigIntOrNull(a.spend_cap),
            minDailyBudget: toBigIntOrNull(a.min_daily_budget),
            minCampaignGroupSpendCap: toBigIntOrNull(a.min_campaign_group_spend_cap),
            isPrepayAccount: a.is_prepay_account ?? null,
            defaultDsaPayor: a.default_dsa_payor ?? null,
            defaultDsaBeneficiary: a.default_dsa_beneficiary ?? null,
            statusCheckIntervalMinutes: defaultIntervalMinutes,
            statsSyncIntervalMinutes: defaultSyncIntervalMinutes,
            lastSyncAt: new Date(),
            lastStatusCheckAt: new Date(),
          },
        });
      } else {
        if (businessId !== existing.businessId)
          await this.prisma.adAccount.update({ where: { id: existing.id }, data: { businessId } });
        await this.accountStatus.apply(existing, a, { notify: true });
      }
    }

    // 3. Pages
    const pages = new Map<string, MetaPage & { source: string }>();
    const myPages = await optional(
      'Pages',
      () => this.graph.paginate<MetaPage>(conn, '/me/accounts', { fields: PAGE_FIELDS }, 'assets.pages'),
      [],
    );
    for (const p of myPages) pages.set(p.id, { ...p, source: 'ME_ACCOUNTS' });
    for (const b of businesses) {
      for (const edge of ['owned_pages', 'client_pages'] as const) {
        const list = await optional(
          `${b.name} ${edge.replace(/_/g, ' ')}`,
          () =>
            this.graph.paginate<MetaPage>(
              conn,
              `/${b.id}/${edge}`,
              { fields: PAGE_FIELDS },
              `assets.${edge}`,
            ),
          [],
        );
        for (const p of list) if (!pages.has(p.id)) pages.set(p.id, { ...p, source: 'BUSINESS' });
      }
    }

    // 4. Per connected ad account: promotable pages, pixels, audiences
    const connected = await this.prisma.adAccount.findMany({ where: { profileId, isConnected: true } });
    let pixelCount = 0;
    let audienceCount = 0;
    for (const acc of connected) {
      const promotable = await optional(
        `${acc.name} promotable pages`,
        () =>
          this.graph.paginate<MetaPage>(
            conn,
            `/${actId(acc.metaAccountId)}/promote_pages`,
            { fields: PAGE_FIELDS },
            'assets.promote_pages',
            { metaAccountId: acc.metaAccountId },
          ),
        [],
      );
      for (const p of promotable) if (!pages.has(p.id)) pages.set(p.id, { ...p, source: 'PROMOTE_PAGES' });
      pixelCount += await this.syncPixels(conn, acc.id, acc.metaAccountId, userId, optional);
      audienceCount += await this.syncAudiences(conn, acc.id, acc.metaAccountId, userId, optional);
    }

    for (const p of pages.values()) {
      await this.prisma.page.upsert({
        where: { profileId_metaPageId: { profileId, metaPageId: p.id } },
        create: {
          userId,
          profileId,
          metaPageId: p.id,
          name: p.name,
          category: p.category ?? null,
          pictureUrl: p.picture?.data?.url ?? null,
          instagramUserId: p.instagram_business_account?.id ?? null,
          instagramUsername: p.instagram_business_account?.username ?? null,
          source: p.source,
        },
        update: {
          name: p.name,
          category: p.category ?? null,
          pictureUrl: p.picture?.data?.url ?? null,
          instagramUserId: p.instagram_business_account?.id ?? null,
          instagramUsername: p.instagram_business_account?.username ?? null,
          lastSyncedAt: new Date(),
        },
      });
    }

    return {
      businesses: businesses.length,
      adAccounts: accounts.size,
      newAdAccounts: newAccounts,
      pages: pages.size,
      pixels: pixelCount,
      audiences: audienceCount,
      warnings,
    };
  }

  async syncPixels(
    conn: MetaConnection,
    adAccountId: string,
    metaAccountId: string,
    userId: string,
    optional: <T>(label: string, fn: () => Promise<T>, fallback: T) => Promise<T>,
  ): Promise<number> {
    const pixels = await optional(
      'Pixels',
      () =>
        this.graph.paginate<{ id: string; name: string; last_fired_time?: string; is_unavailable?: boolean }>(
          conn,
          `/${actId(metaAccountId)}/adspixels`,
          { fields: PIXEL_FIELDS },
          'assets.pixels',
          { metaAccountId },
        ),
      [],
    );
    for (const px of pixels) {
      await this.prisma.pixel.upsert({
        where: { adAccountId_metaPixelId: { adAccountId, metaPixelId: px.id } },
        create: {
          userId,
          adAccountId,
          metaPixelId: px.id,
          name: px.name,
          lastFiredTime: px.last_fired_time ? new Date(px.last_fired_time) : null,
          isUnavailable: !!px.is_unavailable,
        },
        update: {
          name: px.name,
          lastFiredTime: px.last_fired_time ? new Date(px.last_fired_time) : null,
          isUnavailable: !!px.is_unavailable,
          lastSyncedAt: new Date(),
        },
      });
    }
    return pixels.length;
  }

  async syncAudiences(
    conn: MetaConnection,
    adAccountId: string,
    metaAccountId: string,
    userId: string,
    optional: <T>(label: string, fn: () => Promise<T>, fallback: T) => Promise<T>,
  ): Promise<number> {
    const audiences = await optional(
      'Custom audiences',
      () =>
        this.graph.paginate<{
          id: string;
          name: string;
          subtype?: string;
          approximate_count_lower_bound?: number;
          approximate_count_upper_bound?: number;
        }>(
          conn,
          `/${actId(metaAccountId)}/customaudiences`,
          { fields: CUSTOM_AUDIENCE_FIELDS },
          'assets.audiences',
          { metaAccountId },
          2000,
        ),
      [],
    );
    for (const au of audiences) {
      await this.prisma.customAudience.upsert({
        where: { adAccountId_metaAudienceId: { adAccountId, metaAudienceId: au.id } },
        create: {
          userId,
          adAccountId,
          metaAudienceId: au.id,
          name: au.name,
          subtype: au.subtype ?? null,
          approximateCountMin:
            au.approximate_count_lower_bound !== undefined
              ? BigInt(Math.max(0, au.approximate_count_lower_bound))
              : null,
          approximateCountMax:
            au.approximate_count_upper_bound !== undefined
              ? BigInt(Math.max(0, au.approximate_count_upper_bound))
              : null,
        },
        update: {
          name: au.name,
          subtype: au.subtype ?? null,
          approximateCountMin:
            au.approximate_count_lower_bound !== undefined
              ? BigInt(Math.max(0, au.approximate_count_lower_bound))
              : null,
          approximateCountMax:
            au.approximate_count_upper_bound !== undefined
              ? BigInt(Math.max(0, au.approximate_count_upper_bound))
              : null,
          lastSyncedAt: new Date(),
        },
      });
    }
    return audiences.length;
  }
}
