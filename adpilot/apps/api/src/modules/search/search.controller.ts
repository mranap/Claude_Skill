import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, RateLimit, RequireAnyPermission } from '../../common/decorators/auth.decorators';
import { READ_ACCESS, canRead } from '../../common/permissions/read-access';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';

const searchSchema = z.object({ q: z.string().trim().min(2).max(100) });

export interface SearchHit {
  type: 'AD_ACCOUNT' | 'CAMPAIGN' | 'ADSET' | 'AD' | 'TEMPLATE' | 'DRAFT' | 'CREATIVE' | 'META_PROFILE';
  id: string;
  title: string;
  subtitle?: string;
  link: string;
}

/** Global search (⌘K) across the user's own objects only, limited to the areas the user's role can read. */
@RequireAnyPermission(...READ_ACCESS.adAccounts)
@Controller('search')
export class SearchController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RateLimit({ bucket: 'search', limit: 120, windowSeconds: 60 })
  async search(@CurrentUser() user: AuthUser, @Query(zod(searchSchema)) { q }: z.infer<typeof searchSchema>) {
    const userId = user.id;
    const numeric = q.replace(/^act_/, '');
    const isId = /^\d{5,}$/.test(numeric);
    const text = { contains: q, mode: 'insensitive' as const };
    const take = 6;
    const none = Promise.resolve([]);
    const can = (area: Parameters<typeof canRead>[1]) => canRead(user, area);
    const [accounts, campaigns, adSets, ads, templates, drafts, creatives, profiles] = await Promise.all([
      this.prisma.adAccount.findMany({
        where: { userId, profile: { deletedAt: null }, OR: [{ name: text }, ...(isId ? [{ metaAccountId: { startsWith: numeric } }] : [])] },
        take,
        select: { id: true, name: true, metaAccountId: true, currency: true },
      }),
      !can('campaigns')
        ? none
        : this.prisma.campaign.findMany({
            where: { userId, isDeleted: false, OR: [{ name: text }, ...(isId ? [{ metaCampaignId: numeric }] : [])] },
            take,
            select: { id: true, name: true, metaCampaignId: true, effectiveStatus: true },
          }),
      !can('campaigns')
        ? none
        : this.prisma.adSet.findMany({
            where: { userId, isDeleted: false, OR: [{ name: text }, ...(isId ? [{ metaAdSetId: numeric }] : [])] },
            take,
            select: { id: true, name: true, metaAdSetId: true, campaignId: true },
          }),
      !can('campaigns')
        ? none
        : this.prisma.ad.findMany({
            where: { userId, isDeleted: false, OR: [{ name: text }, ...(isId ? [{ metaAdId: numeric }] : [])] },
            take,
            select: { id: true, name: true, metaAdId: true, campaignId: true },
          }),
      !can('templates') ? none : this.prisma.campaignTemplate.findMany({ where: { userId, isArchived: false, name: text }, take, select: { id: true, name: true, objective: true } }),
      !can('drafts') ? none : this.prisma.launchDraft.findMany({ where: { userId, status: 'DRAFT', name: text }, take, select: { id: true, name: true } }),
      !can('creatives') ? none : this.prisma.creativeFile.findMany({ where: { userId, deletedAt: null, originalName: text }, take, select: { id: true, originalName: true, type: true } }),
      !can('metaProfiles') ? none : this.prisma.metaProfile.findMany({ where: { userId, deletedAt: null, name: text }, take, select: { id: true, name: true } }),
    ]);
    const hits: SearchHit[] = [
      ...accounts.map((a) => ({ type: 'AD_ACCOUNT' as const, id: a.id, title: a.name, subtitle: `act_${a.metaAccountId} · ${a.currency}`, link: `/ad-accounts/${a.id}` })),
      ...campaigns.map((c) => ({ type: 'CAMPAIGN' as const, id: c.id, title: c.name, subtitle: `Campaign ${c.metaCampaignId} · ${c.effectiveStatus ?? ''}`, link: `/campaigns/${c.id}` })),
      ...adSets.map((s) => ({ type: 'ADSET' as const, id: s.id, title: s.name, subtitle: `Ad set ${s.metaAdSetId}`, link: `/campaigns/${s.campaignId}?adset=${s.id}` })),
      ...ads.map((a) => ({ type: 'AD' as const, id: a.id, title: a.name, subtitle: `Ad ${a.metaAdId}`, link: `/campaigns/${a.campaignId}?ad=${a.id}` })),
      ...templates.map((t) => ({ type: 'TEMPLATE' as const, id: t.id, title: t.name, subtitle: t.objective, link: `/templates/${t.id}` })),
      ...drafts.map((d) => ({ type: 'DRAFT' as const, id: d.id, title: d.name, subtitle: 'Launch draft', link: `/launch/${d.id}` })),
      ...creatives.map((c) => ({ type: 'CREATIVE' as const, id: c.id, title: c.originalName, subtitle: c.type === 'VIDEO' ? 'Video' : 'Image', link: `/creatives?open=${c.id}` })),
      ...profiles.map((p) => ({ type: 'META_PROFILE' as const, id: p.id, title: p.name, subtitle: 'Meta profile', link: `/meta-profiles/${p.id}` })),
    ];
    return { query: q, hits };
  }
}
