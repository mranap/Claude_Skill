import { Injectable } from '@nestjs/common';
import { AD_ACCOUNT_STATUS_DISPLAY, adAccountStatusKey, disableReasonLabel } from '@adpilot/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ActivityService } from '../activity/activity.service';
import { toBigIntOrNull } from '../meta/meta-fields';
import type { AdAccount } from '../../generated/prisma/client';

export interface MetaAdAccountData {
  id?: string;
  account_id?: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  timezone_offset_hours_utc?: number;
  account_status?: number;
  disable_reason?: number;
  amount_spent?: string;
  balance?: string;
  spend_cap?: string;
  min_daily_budget?: number | string;
  is_prepay_account?: boolean;
  default_dsa_payor?: string;
  default_dsa_beneficiary?: string;
  business?: { id: string; name: string };
}

/**
 * Applies fresh ad account data from Meta. Status transitions are detected with a compare-and-set update
 * (`WHERE accountStatus IS NOT DISTINCT FROM <previous>`), so exactly one status-history row and one
 * notification exist per real change — repeated checks with the same status (DISABLED → DISABLED) are silent.
 */
@Injectable()
export class AccountStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly activity: ActivityService,
  ) {}

  async apply(account: AdAccount, data: MetaAdAccountData, opts: { notify: boolean }): Promise<{ changed: boolean }> {
    const now = new Date();
    const details = {
      name: data.name ?? account.name,
      currency: data.currency ?? account.currency,
      timezoneName: data.timezone_name ?? account.timezoneName,
      timezoneOffsetHours: data.timezone_offset_hours_utc ?? undefined,
      amountSpent: toBigIntOrNull(data.amount_spent) ?? account.amountSpent,
      balance: toBigIntOrNull(data.balance) ?? account.balance,
      spendCap: data.spend_cap !== undefined ? toBigIntOrNull(data.spend_cap) : account.spendCap,
      minDailyBudget: data.min_daily_budget !== undefined ? toBigIntOrNull(data.min_daily_budget) : account.minDailyBudget,
      isPrepayAccount: data.is_prepay_account ?? account.isPrepayAccount,
      defaultDsaPayor: data.default_dsa_payor ?? account.defaultDsaPayor,
      defaultDsaBeneficiary: data.default_dsa_beneficiary ?? account.defaultDsaBeneficiary,
      metaBusinessId: data.business?.id ?? account.metaBusinessId,
      metaBusinessName: data.business?.name ?? account.metaBusinessName,
      lastStatusCheckAt: now,
      statusCheckError: null,
      lastSyncAt: now,
    };

    const newStatus = data.account_status ?? null;
    const statusUnchanged = newStatus === null || newStatus === account.accountStatus;
    if (statusUnchanged) {
      await this.prisma.adAccount.update({ where: { id: account.id }, data: { ...details, disableReason: data.disable_reason ?? account.disableReason } });
      return { changed: false };
    }

    const newKey = adAccountStatusKey(newStatus);
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.adAccount.updateMany({
        where: { id: account.id, accountStatus: account.accountStatus },
        data: { ...details, accountStatus: newStatus, statusKey: newKey, disableReason: data.disable_reason ?? null },
      });
      if (updated.count !== 1) return null; // another worker already recorded this change
      return tx.accountStatusHistory.create({
        data: {
          userId: account.userId,
          adAccountId: account.id,
          fromStatus: account.accountStatus,
          toStatus: newStatus,
          fromKey: account.statusKey,
          toKey: newKey,
          disableReason: data.disable_reason ?? null,
        },
      });
    });
    if (!result) return { changed: false };

    // The very first status we learn about is not a "change" worth notifying.
    const isInitial = account.accountStatus === null;
    if (!isInitial && opts.notify && account.isConnected) {
      const from = AD_ACCOUNT_STATUS_DISPLAY[account.statusKey].label;
      const to = AD_ACCOUNT_STATUS_DISPLAY[newKey].label;
      const reason = disableReasonLabel(data.disable_reason);
      const worse = newKey !== 'ACTIVE' && newKey !== 'ANY_ACTIVE';
      const { notificationId } = await this.notifications.notify({
        userId: account.userId,
        type: 'AD_ACCOUNT_STATUS_CHANGED',
        severity: worse ? 'ERROR' : 'SUCCESS',
        title: `Ad account ${details.name}: ${from} → ${to}`,
        body:
          `Ad account "${details.name}" (${account.metaAccountId}) changed status from ${from} to ${to}.` +
          (reason ? `\nReason: ${reason}.` : '') +
          `\n${AD_ACCOUNT_STATUS_DISPLAY[newKey].description}`,
        link: `/ad-accounts/${account.id}`,
        dedupeKey: `account-status:${result.id}`,
        data: { adAccountId: account.id, from: account.accountStatus, to: newStatus, disableReason: data.disable_reason ?? null },
      });
      await this.prisma.accountStatusHistory.update({ where: { id: result.id }, data: { notificationId: notificationId || null } });
    }
    await this.activity.record({
      userId: account.userId,
      type: 'ACCOUNT_STATUS_CHANGED',
      title: `Ad account status: ${AD_ACCOUNT_STATUS_DISPLAY[account.statusKey].label} → ${AD_ACCOUNT_STATUS_DISPLAY[newKey].label}`,
      source: 'META_SYNC',
      adAccountId: account.id,
      entityLevel: 'ACCOUNT',
      entityMetaId: account.metaAccountId,
      entityName: details.name,
      details: { from: account.accountStatus, to: newStatus, disableReason: data.disable_reason ?? null },
    });
    return { changed: true };
  }

  async markCheckFailed(accountIds: string[], message: string): Promise<void> {
    await this.prisma.adAccount.updateMany({
      where: { id: { in: accountIds } },
      data: { statusCheckError: message.slice(0, 500), lastStatusCheckAt: new Date() },
    });
  }
}
