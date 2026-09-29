/**
 * Queue topology. Each queue is processed by the worker process (scalable horizontally); the API and the
 * scheduler only produce jobs. Job names follow the job types from the specification.
 */
export const QUEUES = {
  META_SYNC: 'meta-sync',
  ACCOUNT_STATUS: 'account-status',
  STATISTICS: 'statistics',
  CAMPAIGN_LAUNCH: 'campaign-launch',
  CREATIVE_UPLOAD: 'creative-upload',
  AUTO_RULES: 'auto-rules',
  EMAIL: 'email',
  TELEGRAM: 'telegram',
  BULK_ACTIONS: 'bulk-actions',
  MAINTENANCE: 'maintenance',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
export const ALL_QUEUES: QueueName[] = Object.values(QUEUES);

export const JOBS = {
  META_SYNC: 'META_SYNC',
  ACCOUNT_STATUS_CHECK: 'ACCOUNT_STATUS_CHECK',
  TOKEN_CHECK: 'TOKEN_CHECK',
  ENTITY_SYNC: 'ENTITY_SYNC',
  STATISTICS_SYNC: 'STATISTICS_SYNC',
  CAMPAIGN_CREATE: 'CAMPAIGN_CREATE',
  CREATIVE_UPLOAD: 'CREATIVE_UPLOAD',
  AUTO_RULE_CHECK: 'AUTO_RULE_CHECK',
  EMAIL_SEND: 'EMAIL_SEND',
  TELEGRAM_SEND: 'TELEGRAM_SEND',
  TELEGRAM_POLL: 'TELEGRAM_POLL',
  BULK_ACTION: 'BULK_ACTION',
  BROADCAST: 'BROADCAST',
  RETENTION_CLEANUP: 'RETENTION_CLEANUP',
  DATABASE_BACKUP: 'DATABASE_BACKUP',
} as const;
export type JobName = (typeof JOBS)[keyof typeof JOBS];

// ───── Job payloads (never contain secrets except where explicitly noted) ─────

export interface MetaSyncJob {
  profileId: string;
  userId: string;
  /** "assets": businesses, ad accounts, pages, pixels. */
  reason: 'manual' | 'scheduled' | 'created';
}

export interface TokenCheckJob {
  profileId: string;
  userId: string;
}

export interface AccountStatusJob {
  profileId: string;
  userId: string;
  adAccountIds: string[];
}

export interface EntitySyncJob {
  adAccountId: string;
  userId: string;
}

export interface StatisticsSyncJob {
  adAccountId: string;
  userId: string;
  reason: 'scheduled' | 'manual' | 'backfill' | 'launch';
}

export interface CampaignCreateJob {
  launchJobId: string;
  userId: string;
}

export interface CreativeUploadJob {
  creativeMetaAssetId: string;
  userId: string;
}

export interface AutoRuleJob {
  ruleId: string;
  userId: string;
  /** Scheduled slot, used for deduplication. */
  slot: string;
}

/**
 * EMAIL_SEND: either a notification delivery (by id) or a system e-mail. System e-mails with a one-time link
 * (password reset, invitation, e-mail change) are `sealed`: the message is encrypted with the platform key
 * while it waits in Redis, and the job is removed as soon as it completes.
 */
export type SystemEmail = { to: string; subject: string; html: string; text: string };
export type EmailJob =
  | { kind: 'delivery'; deliveryId: string }
  | ({ kind: 'system'; tag: string; userId?: string } & SystemEmail)
  | { kind: 'sealed'; sealed: string; tag: string; userId?: string };

export type TelegramJob =
  { kind: 'delivery'; deliveryId: string } | { kind: 'direct'; chatId: string; text: string; tag: string };

export interface BulkActionJob {
  bulkOperationId: string;
  userId: string;
}

export interface BroadcastJob {
  broadcastId: string;
}

export type MaintenanceJob = { kind: 'retention' } | { kind: 'backup'; backupId: string };
