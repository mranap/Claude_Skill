import type {
  NotificationSeverity,
  NotificationType,
  NotificationChannelPref,
  Paginated,
  SettingKey,
  SettingValue,
  UserStatus,
} from '@adpilot/shared';

export type { Paginated };

/** ISO-8601 timestamp as serialised by the API. */
export type ISODateString = string;
/** BigInt values (byte sizes, minor currency units) arrive as decimal strings. */
export type BigIntString = string;

// ───────────── Account ─────────────

export interface SessionDto {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: ISODateString;
  lastUsedAt: ISODateString;
  expiresAt: ISODateString;
  current?: boolean;
}

export interface LoginEventDto {
  id: string;
  success: boolean;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: ISODateString;
}

export interface TwoFactorSetupResponse {
  otpauthUrl: string;
  qrDataUrl: string;
  secret: string;
}

export interface RecoveryCodesResponse {
  recoveryCodes: string[];
}

export interface OkResponse {
  ok: boolean;
  message?: string;
}

// ───────────── Notifications ─────────────

export type DeliveryChannel = 'EMAIL' | 'TELEGRAM';
export type DeliveryStatus = 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'SKIPPED' | 'UNCERTAIN';

export interface NotificationDeliveryDto {
  channel: DeliveryChannel;
  status: DeliveryStatus;
  sentAt: ISODateString | null;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  link: string | null;
  data: unknown;
  readAt: ISODateString | null;
  createdAt: ISODateString;
  deliveries: NotificationDeliveryDto[];
}

export interface NotificationListResponse extends Paginated<NotificationDto> {
  unread: number;
}

export interface NotificationPreferenceDto {
  type: NotificationType;
  channel: NotificationChannelPref;
}

export interface TelegramStatusDto {
  botConfigured: boolean;
  botUsername: string | null;
  connected: boolean;
  username: string | null;
  firstName: string | null;
  linkedAt: ISODateString | null;
  lastError: string | null;
}

export interface TelegramLinkDto {
  url: string;
  expiresAt: ISODateString;
  botUsername: string;
}

// ───────────── Admin: users & roles ─────────────

export interface RoleRef {
  id: string;
  key: string;
  name: string;
}

export interface AdminUserListItem {
  id: string;
  email: string;
  name: string | null;
  status: UserStatus;
  lastLoginAt: ISODateString | null;
  createdAt: ISODateString;
  twoFactorEnabled: boolean;
  storageUsedBytes: BigIntString;
  role: RoleRef;
  usage: {
    metaProfiles: number;
    adAccounts: number;
    campaigns: number;
    files: number;
    storageBytes: BigIntString;
  };
}

export interface AdminUserDetail {
  id: string;
  email: string;
  name: string | null;
  status: UserStatus;
  timezone: string;
  lastLoginAt: ISODateString | null;
  lastLoginIp: string | null;
  createdAt: ISODateString;
  blockedAt: ISODateString | null;
  blockedReason: string | null;
  deletedAt: ISODateString | null;
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
  lockedUntil: ISODateString | null;
  storageUsedBytes: BigIntString;
  storageQuotaBytes: BigIntString | null;
  role: RoleRef;
  telegramConnection: { username: string | null; isActive: boolean; linkedAt: ISODateString } | null;
  _count: {
    metaProfiles: number;
    adAccounts: number;
    campaigns: number;
    creativeFiles: number;
    autoRules: number;
    launchJobs: number;
  };
  sessions: SessionDto[];
  recentLogins: LoginEventDto[];
}

export interface RoleDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  userCount: number;
  editable: boolean;
}

export interface PermissionDto {
  id: string;
  key: string;
  group: string;
  description: string;
}

// ───────────── Admin: logs ─────────────

export interface AuditLogDto {
  id: string;
  actorType: 'USER' | 'SYSTEM';
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  subjectUserId: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: ISODateString;
  actorLabel: string | null;
  subjectLabel: string | null;
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface SystemLogDto {
  id: string;
  level: LogLevel;
  source: string;
  message: string;
  context: unknown;
  userId: string | null;
  jobId: string | null;
  createdAt: ISODateString;
}

export interface MetaApiLogDto {
  id: string;
  userId: string | null;
  profileId: string | null;
  metaAccountId: string | null;
  method: string;
  category: string;
  path: string;
  httpStatus: number | null;
  errorCode: number | null;
  errorSubcode: number | null;
  errorType: string | null;
  errorMessage: string | null;
  fbtraceId: string | null;
  durationMs: number;
  retryCount: number;
  rateLimited: boolean;
  usage: unknown;
  jobId: string | null;
  createdAt: ISODateString;
}

// ───────────── Admin: broadcasts ─────────────

export type JobRunStatus = 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED';

export interface BroadcastDto {
  id: string;
  createdById: string;
  subject: string;
  body: string;
  channels: DeliveryChannel[];
  inApp: boolean;
  audience: 'ALL' | 'SELECTED';
  userIds: string[];
  recipientCount: number;
  status: JobRunStatus;
  error: string | null;
  createdAt: ISODateString;
  completedAt: ISODateString | null;
}

// ───────────── Admin: settings ─────────────

export interface SettingsEnvironment {
  metaGraphApiVersion: string;
  appUrl: string;
  nodeEnv: string;
  storageBucket: string;
  storageEndpoint: string;
  telegramWebhookUrl: string;
}

/** Settings group as returned to admins: public values plus `<secret>Set` flags. */
export type AdminSettingGroup<K extends SettingKey> = SettingValue<K> & Record<`${string}Set`, boolean | undefined>;

export type AdminSettingsResponse = { [K in SettingKey]: AdminSettingGroup<K> } & { environment: SettingsEnvironment };

export interface MetaConnectivityResult {
  ok: boolean;
  latencyMs: number;
  version: string;
  detail: string;
}

export interface TelegramBotTestResult {
  ok: boolean;
  bot: { id: number; username: string };
  sentToYou: boolean;
  webhook: { url?: string; pending_update_count?: number; last_error_message?: string } | null;
}
