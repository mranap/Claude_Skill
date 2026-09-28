import { Injectable } from '@nestjs/common';
import { minorToMajor, type EntityLevel } from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MetaConnectionFactory } from '../meta/meta-connection.factory';
import { MetaGraphClient } from '../meta/graph/meta-graph.client';
import { MetaProfileStatusService } from '../meta/meta-profile-status.service';
import { MetaApiError } from '../meta/graph/meta-errors';
import { AuditService } from '../audit/audit.service';
import { ActivityService } from '../activity/activity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppError } from '../../common/errors/app-error';

type ActionLevel = Exclude<EntityLevel, 'ACCOUNT'>;

export interface EntityRef {
  level: ActionLevel;
  id: string; // internal uuid
  metaId: string;
  name: string;
  userId: string;
  adAccountId: string;
  metaAccountId: string;
  currency: string;
  minDailyBudget: bigint | null;
  status: string | null;
  effectiveStatus: string | null;
  dailyBudget: bigint | null;
  lifetimeBudget: bigint | null;
  campaignId: string;
}

export interface ActionSource {
  source: 'USER' | 'RULE' | 'BULK';
  actorUserId?: string;
  ruleId?: string;
  ruleName?: string;
}

/**
 * The single implementation of "pause/start" and "change budget" used by the UI, bulk actions and automated
 * rules. Every change goes through the central Meta client (rate limits, proxies), updates the local mirror,
 * and writes audit + activity entries.
 */
@Injectable()
export class EntityActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: MetaConnectionFactory,
    private readonly graph: MetaGraphClient,
    private readonly profileStatus: MetaProfileStatusService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Ownership-checked entity lookup by internal id or Meta id. */
  async resolve(userId: string, level: ActionLevel, idOrMetaId: string): Promise<EntityRef> {
    const byMeta = /^\d+$/.test(idOrMetaId);
    const include = { adAccount: { select: { metaAccountId: true, currency: true, minDailyBudget: true } } } as const;
    if (level === 'CAMPAIGN') {
      const c = await this.prisma.campaign.findFirst({ where: { userId, isDeleted: false, ...(byMeta ? { metaCampaignId: idOrMetaId } : { id: idOrMetaId }) }, include });
      if (!c) throw AppError.notFound('Campaign');
      return { level, id: c.id, metaId: c.metaCampaignId, name: c.name, userId, adAccountId: c.adAccountId, metaAccountId: c.adAccount.metaAccountId, currency: c.adAccount.currency, minDailyBudget: c.adAccount.minDailyBudget, status: c.status, effectiveStatus: c.effectiveStatus, dailyBudget: c.dailyBudget, lifetimeBudget: c.lifetimeBudget, campaignId: c.id };
    }
    if (level === 'ADSET') {
      const s = await this.prisma.adSet.findFirst({ where: { userId, isDeleted: false, ...(byMeta ? { metaAdSetId: idOrMetaId } : { id: idOrMetaId }) }, include });
      if (!s) throw AppError.notFound('Ad set');
      return { level, id: s.id, metaId: s.metaAdSetId, name: s.name, userId, adAccountId: s.adAccountId, metaAccountId: s.adAccount.metaAccountId, currency: s.adAccount.currency, minDailyBudget: s.adAccount.minDailyBudget, status: s.status, effectiveStatus: s.effectiveStatus, dailyBudget: s.dailyBudget, lifetimeBudget: s.lifetimeBudget, campaignId: s.campaignId };
    }
    const a = await this.prisma.ad.findFirst({ where: { userId, isDeleted: false, ...(byMeta ? { metaAdId: idOrMetaId } : { id: idOrMetaId }) }, include });
    if (!a) throw AppError.notFound('Ad');
    return { level, id: a.id, metaId: a.metaAdId, name: a.name, userId, adAccountId: a.adAccountId, metaAccountId: a.adAccount.metaAccountId, currency: a.adAccount.currency, minDailyBudget: a.adAccount.minDailyBudget, status: a.status, effectiveStatus: a.effectiveStatus, dailyBudget: null, lifetimeBudget: null, campaignId: a.campaignId };
  }

  private async connFor(e: EntityRef) {
    const account = await this.prisma.adAccount.findUniqueOrThrow({ where: { id: e.adAccountId }, include: { profile: { include: { proxy: true } } } });
    if (!account.isConnected || account.profile.deletedAt || account.profile.status !== 'ACTIVE') {
      throw new AppError('META_AUTH_ERROR', 'The Meta profile of this ad account is not active');
    }
    return { conn: await this.connections.forProfile(account.profile), profileId: account.profileId };
  }

  async setStatus(e: EntityRef, status: 'ACTIVE' | 'PAUSED', src: ActionSource): Promise<{ changed: boolean; before: string | null; after: string }> {
    if (e.status === status) return { changed: false, before: e.status, after: status };
    const { conn, profileId } = await this.connFor(e);
    try {
      await this.graph.call(conn, { method: 'POST', path: `/${e.metaId}`, params: { status }, category: `${e.level.toLowerCase()}.status`, metaAccountId: e.metaAccountId, safeToRetry: true });
    } catch (err) {
      if (err instanceof MetaApiError) await this.profileStatus.onApiError(profileId, err);
      throw this.toAppError(err);
    }
    const data = { status, effectiveStatus: status === 'PAUSED' ? 'PAUSED' : e.effectiveStatus === 'PAUSED' ? 'ACTIVE' : e.effectiveStatus };
    if (e.level === 'CAMPAIGN') await this.prisma.campaign.update({ where: { id: e.id }, data });
    else if (e.level === 'ADSET') await this.prisma.adSet.update({ where: { id: e.id }, data });
    else await this.prisma.ad.update({ where: { id: e.id }, data });

    const verb = status === 'PAUSED' ? 'paused' : 'started';
    await this.audit.log({
      action: `${e.level.toLowerCase()}.${verb}`,
      actorUserId: src.actorUserId ?? null,
      actorType: src.source === 'RULE' ? 'SYSTEM' : 'USER',
      subjectUserId: e.userId,
      targetType: e.level.toLowerCase(),
      targetId: e.metaId,
      metadata: { name: e.name, source: src.source, ruleId: src.ruleId },
    });
    await this.activity.record({
      userId: e.userId,
      type: status === 'PAUSED' ? 'PAUSED' : 'STARTED',
      title: `${this.levelLabel(e.level)} "${e.name}" ${verb}${src.ruleName ? ` by rule "${src.ruleName}"` : ''}`,
      source: src.source === 'RULE' ? 'RULE' : 'USER',
      adAccountId: e.adAccountId,
      entityLevel: e.level,
      entityMetaId: e.metaId,
      entityName: e.name,
      actorUserId: src.actorUserId ?? null,
      details: { status, ruleId: src.ruleId },
    });
    return { changed: true, before: e.status, after: status };
  }

  /** Sets a new daily/lifetime budget (minor units) on a campaign (CBO) or ad set (ABO). */
  async setBudget(e: EntityRef, newMinor: bigint, src: ActionSource): Promise<{ field: 'daily_budget' | 'lifetime_budget'; before: bigint; after: bigint }> {
    if (e.level === 'AD') throw AppError.validation('Ads have no budget');
    const field = e.dailyBudget !== null && e.dailyBudget > 0n ? 'daily_budget' : e.lifetimeBudget !== null && e.lifetimeBudget > 0n ? 'lifetime_budget' : null;
    if (!field) {
      throw AppError.validation(
        e.level === 'CAMPAIGN' ? 'This campaign uses ad set budgets; change the budget of its ad sets instead' : 'This ad set uses the campaign budget; change the campaign budget instead',
      );
    }
    const before = (field === 'daily_budget' ? e.dailyBudget : e.lifetimeBudget)!;
    if (newMinor <= 0n) throw AppError.validation('The budget must be greater than zero');
    if (field === 'daily_budget' && e.minDailyBudget && newMinor < e.minDailyBudget) {
      throw AppError.validation(`The daily budget cannot be lower than ${minorToMajor(e.minDailyBudget, e.currency)} ${e.currency} for this ad account`);
    }
    if (newMinor === before) return { field, before, after: newMinor };
    const { conn, profileId } = await this.connFor(e);
    try {
      await this.graph.call(conn, { method: 'POST', path: `/${e.metaId}`, params: { [field]: newMinor.toString() }, category: `${e.level.toLowerCase()}.budget`, metaAccountId: e.metaAccountId, safeToRetry: true });
    } catch (err) {
      if (err instanceof MetaApiError) await this.profileStatus.onApiError(profileId, err);
      throw this.toAppError(err);
    }
    const data = field === 'daily_budget' ? { dailyBudget: newMinor } : { lifetimeBudget: newMinor };
    if (e.level === 'CAMPAIGN') await this.prisma.campaign.update({ where: { id: e.id }, data });
    else await this.prisma.adSet.update({ where: { id: e.id }, data });

    const from = `${minorToMajor(before, e.currency)} ${e.currency}`;
    const to = `${minorToMajor(newMinor, e.currency)} ${e.currency}`;
    await this.audit.log({
      action: 'budget.changed',
      actorUserId: src.actorUserId ?? null,
      actorType: src.source === 'RULE' ? 'SYSTEM' : 'USER',
      subjectUserId: e.userId,
      targetType: e.level.toLowerCase(),
      targetId: e.metaId,
      metadata: { name: e.name, field, before: before.toString(), after: newMinor.toString(), currency: e.currency, source: src.source, ruleId: src.ruleId },
    });
    await this.activity.record({
      userId: e.userId,
      type: 'BUDGET_CHANGED',
      title: `${this.levelLabel(e.level)} "${e.name}" budget ${from} → ${to}${src.ruleName ? ` (rule "${src.ruleName}")` : ''}`,
      source: src.source === 'RULE' ? 'RULE' : 'USER',
      adAccountId: e.adAccountId,
      entityLevel: e.level,
      entityMetaId: e.metaId,
      entityName: e.name,
      actorUserId: src.actorUserId ?? null,
      details: { field, before: before.toString(), after: newMinor.toString(), currency: e.currency },
    });
    await this.notifications.notify({
      userId: e.userId,
      type: 'BUDGET_CHANGED',
      severity: 'INFO',
      title: `Budget changed: ${e.name}`,
      body: `${this.levelLabel(e.level)} "${e.name}": ${field === 'daily_budget' ? 'daily' : 'lifetime'} budget ${from} → ${to}${src.ruleName ? ` by rule "${src.ruleName}"` : ''}.`,
      link: `/campaigns/${e.campaignId}`,
    });
    return { field, before, after: newMinor };
  }

  private levelLabel(level: ActionLevel): string {
    return level === 'CAMPAIGN' ? 'Campaign' : level === 'ADSET' ? 'Ad set' : 'Ad';
  }

  private toAppError(err: unknown): unknown {
    if (err instanceof MetaApiError) {
      const code =
        err.category === 'RATE_LIMIT' ? 'META_RATE_LIMITED' : err.category === 'AUTH' ? 'META_AUTH_ERROR' : err.category === 'PERMISSION' ? 'META_PERMISSION_ERROR' : 'META_API_ERROR';
      return new AppError(code, err.details.friendlyMessage, undefined, {
        meta: err.details,
        retryAfterSeconds: err.details.retryAfterMs ? Math.ceil(err.details.retryAfterMs / 1000) : undefined,
      });
    }
    return err;
  }
}
