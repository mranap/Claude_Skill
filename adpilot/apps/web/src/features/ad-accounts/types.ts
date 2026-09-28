import type { AdAccountStatusKey, MetaProfileStatus, StatusTone, SyncStatus } from '@adpilot/shared';
import type { BigIntString, ISODateString } from '@/lib/api/types';

/** GET /ad-accounts items. Money values are major-unit decimal strings in `currency`. */
export interface AdAccountDto {
  id: string;
  profileId: string;
  profileName: string;
  profileStatus: MetaProfileStatus;
  metaAccountId: string;
  name: string;
  currency: string;
  timezoneName: string;
  accountStatus: number | null;
  statusKey: AdAccountStatusKey;
  statusLabel: string;
  statusGroup: string;
  statusTone: StatusTone;
  disableReason: number | null;
  disableReasonLabel: string | null;
  amountSpent: string | null;
  balance: string | null;
  spendCap: string | null;
  minDailyBudget: string | null;
  business: { id: string; name: string | null } | null;
  isConnected: boolean;
  statusCheckIntervalMinutes: number;
  lastStatusCheckAt: ISODateString | null;
  nextStatusCheckAt: ISODateString | null;
  statusCheckError: string | null;
  statsSyncEnabled: boolean;
  statsSyncIntervalMinutes: number;
  lastStatsSyncAt: ISODateString | null;
  nextStatsSyncAt: ISODateString | null;
  statsSyncStatus: SyncStatus;
  statsSyncError: string | null;
  lastManualRefreshAt: ISODateString | null;
  lastSyncAt: ISODateString | null;
  defaultDsaPayor: string | null;
  defaultDsaBeneficiary: string | null;
}

export interface AdAccountDetailDto extends AdAccountDto {
  counts: { pixels: number; audiences: number; campaigns: number };
}

export interface StatusHistoryDto {
  id: string;
  adAccountId: string;
  fromStatus: number | null;
  toStatus: number | null;
  fromKey: AdAccountStatusKey | null;
  toKey: AdAccountStatusKey;
  disableReason: number | null;
  notificationId: string | null;
  detectedAt: ISODateString;
}

export interface PixelDto {
  id: string;
  adAccountId: string;
  metaPixelId: string;
  name: string;
  lastFiredTime: ISODateString | null;
  isUnavailable: boolean;
  lastSyncedAt: ISODateString;
}

export interface AudienceDto {
  id: string;
  adAccountId: string;
  metaAudienceId: string;
  name: string;
  subtype: string | null;
  approximateCountMin: BigIntString | null;
  approximateCountMax: BigIntString | null;
  lastSyncedAt: ISODateString;
}
