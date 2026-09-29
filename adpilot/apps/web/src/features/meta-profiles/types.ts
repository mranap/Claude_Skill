import type {
  AdAccountStatusKey,
  MetaProfileStatus,
  ProxyTestResult,
  ProxyType,
  SyncStatus,
  TokenInspection,
} from '@adpilot/shared';
import type { ISODateString } from '@/lib/api/types';

export type TokenType = 'USER' | 'SYSTEM_USER' | 'PAGE' | 'APP' | 'UNKNOWN';

export interface ProxyDto {
  id: string;
  type: ProxyType;
  host: string;
  port: number;
  username: string | null;
  hasPassword: boolean;
  lastTestAt: ISODateString | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  lastTestLatencyMs: number | null;
}

/** GET /meta-profiles items. The access token is never returned — only `tokenMask`. */
export interface MetaProfileDto {
  id: string;
  name: string;
  notes: string | null;
  status: MetaProfileStatus;
  statusLabel: string;
  isEnabled: boolean;
  tokenMask: string;
  tokenType: TokenType;
  tokenExpiresAt: ISODateString | null;
  dataAccessExpiresAt: ISODateString | null;
  tokenScopes: string[];
  tokenAppId: string | null;
  metaUserId: string | null;
  metaUserName: string | null;
  appId: string | null;
  hasAppSecret: boolean;
  proxy: ProxyDto | null;
  lastValidatedAt: ISODateString | null;
  lastValidationError: string | null;
  syncStatus: SyncStatus;
  lastSyncAt: ISODateString | null;
  syncError: string | null;
  counts: { businesses: number; adAccounts: number; connectedAdAccounts: number; pages: number };
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface ProfileSaveResponse {
  profile: MetaProfileDto;
  inspection?: TokenInspection;
}

export interface ConnectionTestResponse {
  token?: TokenInspection;
  proxy?: ProxyTestResult;
}

export interface BusinessAccountDto {
  id: string;
  metaBusinessId: string;
  name: string;
  verificationStatus: string | null;
  isSelected: boolean;
  lastSyncedAt: ISODateString;
}

export interface ProfileAdAccountDto {
  id: string;
  metaAccountId: string;
  name: string;
  currency: string;
  timezoneName: string;
  statusKey: AdAccountStatusKey;
  accountStatus: number | null;
  isConnected: boolean;
  metaBusinessId: string | null;
  metaBusinessName: string | null;
}

export interface PageDto {
  id: string;
  metaPageId: string;
  name: string;
  category: string | null;
  pictureUrl: string | null;
  instagramUserId: string | null;
  instagramUsername: string | null;
  source: string;
  isSelected: boolean;
  lastSyncedAt: ISODateString;
}

export interface ProfileAssets {
  businesses: BusinessAccountDto[];
  adAccounts: ProfileAdAccountDto[];
  pages: PageDto[];
}
