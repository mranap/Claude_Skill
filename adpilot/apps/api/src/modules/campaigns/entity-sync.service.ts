import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActivityService } from '../activity/activity.service';
import { MetaConnection, MetaGraphClient } from '../meta/graph/meta-graph.client';
import { ADSET_FIELDS, AD_FIELDS, CAMPAIGN_FIELDS, actId, toBigIntOrNull } from '../meta/meta-fields';
import { Prisma, type AdAccount } from '../../generated/prisma/client';

interface MetaCampaign {
  id: string;
  name: string;
  objective?: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  budget_remaining?: string;
  spend_cap?: string;
  bid_strategy?: string;
  buying_type?: string;
  special_ad_categories?: string[];
  is_adset_budget_sharing_enabled?: boolean;
  start_time?: string;
  stop_time?: string;
  created_time?: string;
  updated_time?: string;
  issues_info?: unknown;
}

interface MetaAdSet {
  id: string;
  name: string;
  campaign_id: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  budget_remaining?: string;
  optimization_goal?: string;
  billing_event?: string;
  bid_strategy?: string;
  bid_amount?: number | string;
  destination_type?: string;
  targeting?: { geo_locations?: { countries?: string[] } } & Record<string, unknown>;
  start_time?: string;
  end_time?: string;
  created_time?: string;
  updated_time?: string;
  issues_info?: unknown;
}

interface MetaAd {
  id: string;
  name: string;
  adset_id: string;
  campaign_id: string;
  status?: string;
  effective_status?: string;
  creative?: { id: string };
  ad_review_feedback?: unknown;
  issues_info?: unknown;
  created_time?: string;
  updated_time?: string;
}

const CAMPAIGN_STATUSES = ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'ARCHIVED'];
const ADSET_STATUSES = ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'ARCHIVED'];
const AD_STATUSES = ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED', 'PENDING_BILLING_INFO', 'ARCHIVED'];
const MAX_CAMPAIGNS = 5000;
const MAX_ADSETS = 10_000;
const MAX_ADS = 10_000;

const date = (v?: string) => (v ? new Date(v) : null);

/**
 * Mirrors campaigns, ad sets and ads of connected ad accounts into the database (campaign table, rules,
 * bulk actions) and detects delivery-relevant changes made outside the platform: a campaign that stopped
 * delivering or an ad that Meta rejected produce one notification per change.
 */
@Injectable()
export class EntitySyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: MetaGraphClient,
    private readonly notifications: NotificationsService,
    private readonly activity: ActivityService,
  ) {}

  async syncAccount(account: AdAccount, conn: MetaConnection): Promise<{ campaigns: number; adSets: number; ads: number }> {
    const metaAccountId = account.metaAccountId;
    const act = actId(metaAccountId);
    const [campaigns, adSets, ads] = await Promise.all([
      this.graph.paginate<MetaCampaign>(conn, `/${act}/campaigns`, { fields: CAMPAIGN_FIELDS, effective_status: CAMPAIGN_STATUSES }, 'entities.campaigns', { metaAccountId }, MAX_CAMPAIGNS),
      this.graph.paginate<MetaAdSet>(conn, `/${act}/adsets`, { fields: ADSET_FIELDS, effective_status: ADSET_STATUSES }, 'entities.adsets', { metaAccountId }, MAX_ADSETS),
      this.graph.paginate<MetaAd>(conn, `/${act}/ads`, { fields: AD_FIELDS, effective_status: AD_STATUSES }, 'entities.ads', { metaAccountId }, MAX_ADS),
    ]);
    await this.upsert(account, campaigns, adSets, ads, {});
    // Objects that disappeared from Meta (deleted) are flagged — per level, and only when that listing was
    // complete (a truncated list must never mark existing objects as deleted).
    if (campaigns.length < MAX_CAMPAIGNS) {
      await this.prisma.campaign.updateMany({ where: { adAccountId: account.id, isDeleted: false, metaCampaignId: { notIn: campaigns.map((c) => c.id) } }, data: { isDeleted: true } });
    }
    if (adSets.length < MAX_ADSETS) {
      await this.prisma.adSet.updateMany({ where: { adAccountId: account.id, isDeleted: false, metaAdSetId: { notIn: adSets.map((s) => s.id) } }, data: { isDeleted: true } });
    }
    if (ads.length < MAX_ADS) {
      await this.prisma.ad.updateMany({ where: { adAccountId: account.id, isDeleted: false, metaAdId: { notIn: ads.map((a) => a.id) } }, data: { isDeleted: true } });
    }
    await this.prisma.adAccount.update({ where: { id: account.id }, data: { entitiesSyncedAt: new Date() } });
    return { campaigns: campaigns.length, adSets: adSets.length, ads: ads.length };
  }

  /** Syncs one campaign with its ad sets and ads (after a launch). */
  async syncCampaignTree(account: AdAccount, conn: MetaConnection, campaignMetaId: string, links: { launchJobId?: string; templateId?: string | null }) {
    const metaAccountId = account.metaAccountId;
    const [campaign, adSets, ads] = await Promise.all([
      this.graph.get<MetaCampaign>(conn, `/${campaignMetaId}`, { fields: CAMPAIGN_FIELDS }, 'entities.campaign', { metaAccountId }),
      this.graph.paginate<MetaAdSet>(conn, `/${campaignMetaId}/adsets`, { fields: ADSET_FIELDS }, 'entities.adsets', { metaAccountId }, 2000),
      this.graph.paginate<MetaAd>(conn, `/${campaignMetaId}/ads`, { fields: AD_FIELDS }, 'entities.ads', { metaAccountId }, 5000),
    ]);
    await this.upsert(account, [campaign], adSets, ads, links);
  }

  private async upsert(account: AdAccount, campaigns: MetaCampaign[], adSets: MetaAdSet[], ads: MetaAd[], links: { launchJobId?: string; templateId?: string | null }) {
    const countriesByCampaign = new Map<string, Set<string>>();
    for (const s of adSets) {
      const set = countriesByCampaign.get(s.campaign_id) ?? new Set<string>();
      for (const c of s.targeting?.geo_locations?.countries ?? []) set.add(c);
      countriesByCampaign.set(s.campaign_id, set);
    }

    const campaignIds = new Map<string, string>();
    for (const c of campaigns) {
      const prev = await this.prisma.campaign.findUnique({ where: { adAccountId_metaCampaignId: { adAccountId: account.id, metaCampaignId: c.id } } });
      const data = {
        name: c.name,
        objective: c.objective ?? null,
        status: c.status ?? null,
        effectiveStatus: c.effective_status ?? null,
        dailyBudget: toBigIntOrNull(c.daily_budget),
        lifetimeBudget: toBigIntOrNull(c.lifetime_budget),
        budgetRemaining: toBigIntOrNull(c.budget_remaining),
        spendCap: toBigIntOrNull(c.spend_cap),
        bidStrategy: c.bid_strategy ?? null,
        buyingType: c.buying_type ?? null,
        specialAdCategories: c.special_ad_categories ?? [],
        budgetSharing: c.is_adset_budget_sharing_enabled ?? null,
        startTime: date(c.start_time),
        stopTime: date(c.stop_time),
        countries: [...(countriesByCampaign.get(c.id) ?? new Set(prev?.countries ?? []))],
        issuesInfo: (c.issues_info ?? Prisma.DbNull) as Prisma.InputJsonValue,
        metaCreatedTime: date(c.created_time),
        metaUpdatedTime: date(c.updated_time),
        isDeleted: false,
        lastSyncedAt: new Date(),
      };
      const row = prev
        ? await this.prisma.campaign.update({ where: { id: prev.id }, data })
        : await this.prisma.campaign.create({
            data: { ...data, userId: account.userId, adAccountId: account.id, metaCampaignId: c.id, launchJobId: links.launchJobId ?? null, templateId: links.templateId ?? null },
          });
      campaignIds.set(c.id, row.id);
      if (prev && prev.effectiveStatus === 'ACTIVE' && c.effective_status && c.effective_status !== 'ACTIVE' && c.effective_status !== 'IN_PROCESS') {
        await this.notifyStopped(account, row.id, c.id, c.name, c.effective_status);
      }
    }

    const adSetIds = new Map<string, { id: string; campaignId: string }>();
    for (const s of adSets) {
      let campaignId = campaignIds.get(s.campaign_id);
      if (!campaignId) {
        campaignId = (await this.prisma.campaign.findUnique({ where: { adAccountId_metaCampaignId: { adAccountId: account.id, metaCampaignId: s.campaign_id } }, select: { id: true } }))?.id;
      }
      if (!campaignId) continue;
      const data = {
        name: s.name,
        campaignId,
        metaCampaignId: s.campaign_id,
        status: s.status ?? null,
        effectiveStatus: s.effective_status ?? null,
        dailyBudget: toBigIntOrNull(s.daily_budget),
        lifetimeBudget: toBigIntOrNull(s.lifetime_budget),
        budgetRemaining: toBigIntOrNull(s.budget_remaining),
        optimizationGoal: s.optimization_goal ?? null,
        billingEvent: s.billing_event ?? null,
        bidStrategy: s.bid_strategy ?? null,
        bidAmount: toBigIntOrNull(s.bid_amount),
        destinationType: s.destination_type ?? null,
        countries: s.targeting?.geo_locations?.countries ?? [],
        targeting: (s.targeting ?? Prisma.DbNull) as Prisma.InputJsonValue,
        startTime: date(s.start_time),
        endTime: date(s.end_time),
        issuesInfo: (s.issues_info ?? Prisma.DbNull) as Prisma.InputJsonValue,
        metaCreatedTime: date(s.created_time),
        metaUpdatedTime: date(s.updated_time),
        isDeleted: false,
        lastSyncedAt: new Date(),
      };
      const row = await this.prisma.adSet.upsert({
        where: { adAccountId_metaAdSetId: { adAccountId: account.id, metaAdSetId: s.id } },
        create: { ...data, userId: account.userId, adAccountId: account.id, metaAdSetId: s.id },
        update: data,
      });
      adSetIds.set(s.id, { id: row.id, campaignId });
    }

    for (const a of ads) {
      let parent = adSetIds.get(a.adset_id);
      if (!parent) {
        const s = await this.prisma.adSet.findUnique({ where: { adAccountId_metaAdSetId: { adAccountId: account.id, metaAdSetId: a.adset_id } }, select: { id: true, campaignId: true } });
        if (s) parent = s;
      }
      if (!parent) continue;
      const prev = await this.prisma.ad.findUnique({ where: { adAccountId_metaAdId: { adAccountId: account.id, metaAdId: a.id } }, select: { effectiveStatus: true } });
      const data = {
        name: a.name,
        adSetId: parent.id,
        campaignId: parent.campaignId,
        metaAdSetId: a.adset_id,
        metaCampaignId: a.campaign_id,
        status: a.status ?? null,
        effectiveStatus: a.effective_status ?? null,
        metaCreativeId: a.creative?.id ?? null,
        reviewFeedback: (a.ad_review_feedback ?? Prisma.DbNull) as Prisma.InputJsonValue,
        issuesInfo: (a.issues_info ?? Prisma.DbNull) as Prisma.InputJsonValue,
        metaCreatedTime: date(a.created_time),
        metaUpdatedTime: date(a.updated_time),
        isDeleted: false,
        lastSyncedAt: new Date(),
      };
      await this.prisma.ad.upsert({
        where: { adAccountId_metaAdId: { adAccountId: account.id, metaAdId: a.id } },
        create: { ...data, userId: account.userId, adAccountId: account.id, metaAdId: a.id },
        update: data,
      });
      const rejected = a.effective_status === 'DISAPPROVED' || a.effective_status === 'WITH_ISSUES';
      if (rejected && prev?.effectiveStatus !== a.effective_status) {
        await this.notifyRejected(account, parent.campaignId, a);
      }
    }
  }

  private async notifyStopped(account: AdAccount, campaignRowId: string, metaId: string, name: string, status: string) {
    const readable = status.replace(/_/g, ' ').toLowerCase();
    await this.notifications.notify({
      userId: account.userId,
      type: 'CAMPAIGN_STOPPED',
      severity: 'WARNING',
      title: `Campaign stopped: ${name}`,
      body: `Campaign "${name}" in ${account.name} is no longer active (status: ${readable}).`,
      link: `/campaigns/${campaignRowId}`,
      dedupeKey: `campaign-stopped:${metaId}:${status}:${new Date().toISOString().slice(0, 10)}`,
    });
    await this.activity.record({
      userId: account.userId,
      type: 'STATUS_CHANGED',
      title: `Campaign "${name}" → ${readable}`,
      source: 'META_SYNC',
      adAccountId: account.id,
      entityLevel: 'CAMPAIGN',
      entityMetaId: metaId,
      entityName: name,
      details: { status },
    });
  }

  private async notifyRejected(account: AdAccount, campaignRowId: string, ad: MetaAd) {
    const feedback = ad.ad_review_feedback as { global?: Record<string, string> } | undefined;
    const reasons = feedback?.global ? Object.values(feedback.global).join(' ') : '';
    await this.notifications.notify({
      userId: account.userId,
      type: 'AD_REJECTED',
      severity: 'ERROR',
      title: `Ad ${ad.effective_status === 'DISAPPROVED' ? 'rejected' : 'has issues'}: ${ad.name}`,
      body: `Meta reports "${ad.effective_status}" for ad "${ad.name}" in ${account.name}.${reasons ? `\nReason: ${reasons.slice(0, 600)}` : ''}`,
      link: `/campaigns/${campaignRowId}`,
      dedupeKey: `ad-status:${ad.id}:${ad.effective_status}`,
    });
    await this.activity.record({
      userId: account.userId,
      type: 'AD_REJECTED',
      title: `Ad "${ad.name}" → ${ad.effective_status}`,
      source: 'META_SYNC',
      adAccountId: account.id,
      entityLevel: 'AD',
      entityMetaId: ad.id,
      entityName: ad.name,
      details: { status: ad.effective_status, feedback: ad.ad_review_feedback ?? null },
    });
  }
}
