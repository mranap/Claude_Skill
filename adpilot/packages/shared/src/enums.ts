// String unions mirroring the Prisma enums (kept in sync by a unit test in the API package).

export const USER_STATUSES = ['ACTIVE', 'BLOCKED', 'DELETED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'AD_ACCOUNT_STATUS_CHANGED',
  'TOKEN_EXPIRED',
  'TOKEN_REVOKED',
  'TOKEN_EXPIRING_SOON',
  'CAMPAIGN_STOPPED',
  'CAMPAIGN_LAUNCHED',
  'AD_REJECTED',
  'AUTO_RULE_TRIGGERED',
  'BUDGET_CHANGED',
  'CAMPAIGN_CREATION_FAILED',
  'STATISTICS_SYNC_FAILED',
  'ACCOUNT_SYNC_FAILED',
  'SECURITY_ALERT',
  'SYSTEM_MESSAGE',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, { label: string; description: string }> = {
  AD_ACCOUNT_STATUS_CHANGED: {
    label: 'Ad account status changed',
    description: 'An ad account changed status (e.g. Active → Disabled). Sent once per real change.',
  },
  TOKEN_EXPIRED: { label: 'Token expired', description: 'A Meta access token has expired.' },
  TOKEN_REVOKED: {
    label: 'Token revoked / invalid',
    description: 'A Meta token became invalid or its permissions were revoked.',
  },
  TOKEN_EXPIRING_SOON: {
    label: 'Token expiring soon',
    description: 'A Meta token will expire within 7 days.',
  },
  CAMPAIGN_STOPPED: {
    label: 'Campaign stopped',
    description: 'A campaign stopped delivering (paused outside the platform, disapproved, account issue).',
  },
  CAMPAIGN_LAUNCHED: { label: 'Campaign launched', description: 'A launch job finished successfully.' },
  AD_REJECTED: { label: 'Ad rejected', description: 'Meta disapproved an ad or reported delivery issues.' },
  AUTO_RULE_TRIGGERED: { label: 'Auto rule triggered', description: 'One of your automated rules acted.' },
  BUDGET_CHANGED: { label: 'Budget changed', description: 'A budget was changed by you or by a rule.' },
  CAMPAIGN_CREATION_FAILED: {
    label: 'Campaign creation failed',
    description: 'A launch job failed or finished with partial failures.',
  },
  STATISTICS_SYNC_FAILED: {
    label: 'Statistics sync failed',
    description: 'Statistics could not be synchronised for an ad account.',
  },
  ACCOUNT_SYNC_FAILED: {
    label: 'Account sync failed',
    description: 'Ad accounts, pages or campaigns could not be synchronised.',
  },
  SECURITY_ALERT: {
    label: 'Security alerts',
    description: 'Password/2FA/email changes and new sign-ins on your account.',
  },
  SYSTEM_MESSAGE: { label: 'System messages', description: 'Messages from the platform administrators.' },
};

export const NOTIFICATION_CHANNEL_PREFS = ['EMAIL', 'TELEGRAM', 'BOTH', 'OFF'] as const;
export type NotificationChannelPref = (typeof NOTIFICATION_CHANNEL_PREFS)[number];

/** Defaults applied when a user has not configured a notification type yet. */
export const DEFAULT_NOTIFICATION_PREFS: Record<NotificationType, NotificationChannelPref> = {
  AD_ACCOUNT_STATUS_CHANGED: 'BOTH',
  TOKEN_EXPIRED: 'BOTH',
  TOKEN_REVOKED: 'BOTH',
  TOKEN_EXPIRING_SOON: 'EMAIL',
  CAMPAIGN_STOPPED: 'TELEGRAM',
  CAMPAIGN_LAUNCHED: 'TELEGRAM',
  AD_REJECTED: 'BOTH',
  AUTO_RULE_TRIGGERED: 'TELEGRAM',
  BUDGET_CHANGED: 'OFF',
  CAMPAIGN_CREATION_FAILED: 'BOTH',
  STATISTICS_SYNC_FAILED: 'OFF',
  ACCOUNT_SYNC_FAILED: 'EMAIL',
  SECURITY_ALERT: 'EMAIL',
  SYSTEM_MESSAGE: 'BOTH',
};

export const NOTIFICATION_SEVERITIES = ['INFO', 'SUCCESS', 'WARNING', 'ERROR'] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const PROXY_TYPES = ['HTTP', 'HTTPS', 'SOCKS5'] as const;
export type ProxyType = (typeof PROXY_TYPES)[number];

export const META_PROFILE_STATUSES = [
  'UNCHECKED',
  'ACTIVE',
  'EXPIRED',
  'INVALID',
  'PERMISSION_REVOKED',
  'ERROR',
] as const;
export type MetaProfileStatus = (typeof META_PROFILE_STATUSES)[number];

export const META_PROFILE_STATUS_LABELS: Record<MetaProfileStatus, string> = {
  UNCHECKED: 'Not checked yet',
  ACTIVE: 'Active',
  EXPIRED: 'Token expired',
  INVALID: 'Token invalid',
  PERMISSION_REVOKED: 'Permissions revoked',
  ERROR: 'Connection error',
};

export const SYNC_STATUSES = ['IDLE', 'QUEUED', 'RUNNING', 'SUCCESS', 'FAILED'] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const CREATIVE_TYPES = ['IMAGE', 'VIDEO'] as const;
export type CreativeType = (typeof CREATIVE_TYPES)[number];

export const LAUNCH_JOB_STATUSES = [
  'QUEUED',
  'VALIDATING',
  'UPLOADING_CREATIVES',
  'CREATING_CAMPAIGN',
  'CREATING_ADSETS',
  'CREATING_ADS',
  'VERIFYING',
  'ACTIVATING',
  'COMPLETED',
  'PARTIAL_FAILURE',
  'FAILED',
  'CANCELLED',
] as const;
export type LaunchJobStatus = (typeof LAUNCH_JOB_STATUSES)[number];
export const LAUNCH_JOB_TERMINAL_STATUSES: LaunchJobStatus[] = [
  'COMPLETED',
  'PARTIAL_FAILURE',
  'FAILED',
  'CANCELLED',
];

export const LAUNCH_ITEM_KINDS = ['MEDIA_IMAGE', 'MEDIA_VIDEO', 'CAMPAIGN', 'ADSET', 'CREATIVE', 'AD'] as const;
export type LaunchItemKind = (typeof LAUNCH_ITEM_KINDS)[number];

export const LAUNCH_ITEM_STATUSES = ['PENDING', 'IN_FLIGHT', 'CREATED', 'VERIFIED', 'FAILED', 'SKIPPED'] as const;
export type LaunchItemStatus = (typeof LAUNCH_ITEM_STATUSES)[number];

export const ENTITY_LEVELS = ['ACCOUNT', 'CAMPAIGN', 'ADSET', 'AD'] as const;
export type EntityLevel = (typeof ENTITY_LEVELS)[number];

export const RULE_ACTIONS = [
  'PAUSE',
  'START',
  'INCREASE_BUDGET',
  'DECREASE_BUDGET',
  'SET_BUDGET',
  'NOTIFY_ONLY',
] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];

export const RULE_TIME_RANGES = ['TODAY', 'YESTERDAY', 'LAST_N_HOURS', 'LAST_N_DAYS'] as const;
export type RuleTimeRange = (typeof RULE_TIME_RANGES)[number];

export const RULE_EXECUTION_RESULTS = ['PENDING', 'SUCCESS', 'FAILED', 'SKIPPED', 'DRY_RUN', 'NOTIFIED'] as const;
export type RuleExecutionResult = (typeof RULE_EXECUTION_RESULTS)[number];

export const DRAFT_STATUSES = ['DRAFT', 'LAUNCHED', 'ARCHIVED'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];
