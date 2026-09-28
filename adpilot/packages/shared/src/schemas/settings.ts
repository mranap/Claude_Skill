import { z } from 'zod';
import { META_MEDIA_LIMITS } from '../meta/media';

/**
 * System settings managed from the Super Admin UI. Each key is stored as one JSON row in
 * `system_settings`. Secret fields (listed in SECRET_SETTING_FIELDS) are stored encrypted and are never
 * returned to the browser — the API returns `{ <field>Set: boolean }` instead.
 */

export const generalSettingsSchema = z.object({
  platformName: z.string().trim().min(1).max(60).default('AdPilot'),
  supportEmail: z.union([z.email(), z.literal('')]).default(''),
  defaultTimezone: z.string().trim().min(1).max(64).default('UTC'),
});

export const securitySettingsSchema = z.object({
  sessionLifetimeDays: z.number().int().min(1).max(90).default(30),
  sessionIdleDays: z.number().int().min(1).max(30).default(7),
  maxFailedLogins: z.number().int().min(3).max(20).default(5),
  lockoutMinutes: z.number().int().min(1).max(1440).default(15),
  loginRateLimitPerMinute: z.number().int().min(3).max(200).default(20),
  require2faForAdmins: z.boolean().default(false),
  passwordResetTtlMinutes: z.number().int().min(10).max(1440).default(60),
});

export const fileSettingsSchema = z.object({
  maxImageSizeMb: z.number().int().min(1).max(META_MEDIA_LIMITS.image.maxSizeMb).default(30),
  maxVideoSizeMb: z.number().int().min(1).max(META_MEDIA_LIMITS.video.maxSizeMb).default(1024),
  maxUploadSizeMb: z.number().int().min(1).max(META_MEDIA_LIMITS.video.maxSizeMb).default(1024),
  maxUserStorageMb: z.number().int().min(10).max(10_000_000).default(20480),
  maxFilesPerUpload: z.number().int().min(1).max(100).default(20),
});

export const statisticsSettingsSchema = z.object({
  /** Minimum allowed automatic statistics sync interval. Product requirement: 35 minutes by default. */
  minSyncIntervalMinutes: z.number().int().min(15).max(1440).default(35),
  defaultSyncIntervalMinutes: z.number().int().min(15).max(1440).default(60),
  manualRefreshCooldownMinutes: z.number().int().min(1).max(1440).default(10),
  /** Days re-fetched on every sync (Meta revises recent days as attribution matures). */
  lookbackDays: z.number().int().min(1).max(28).default(3),
  /** Days fetched on the first sync of an ad account. */
  backfillDays: z.number().int().min(1).max(90).default(30),
});

export const accountCheckSettingsSchema = z.object({
  allowedIntervalsMinutes: z
    .array(z.number().int().min(15).max(10080))
    .min(1)
    .default([60, 180, 360, 720, 1440]),
  defaultIntervalMinutes: z.number().int().min(15).max(10080).default(180),
});

export const rulesSettingsSchema = z.object({
  minCheckIntervalMinutes: z.number().int().min(15).max(1440).default(35),
  maxRulesPerUser: z.number().int().min(1).max(1000).default(100),
  maxEntitiesPerEvaluation: z.number().int().min(10).max(5000).default(500),
});

export const metaSettingsSchema = z.object({
  appId: z.string().trim().max(40).default(''),
  /** Slow down when any Meta usage header reaches this percentage. */
  throttleThresholdPct: z.number().int().min(10).max(99).default(75),
  /** Stop sending requests for a scope when usage reaches this percentage. */
  pauseThresholdPct: z.number().int().min(20).max(100).default(90),
  maxConcurrentRequestsPerAccount: z.number().int().min(1).max(20).default(4),
  tokenCheckIntervalHours: z.number().int().min(1).max(168).default(12),
  assetSyncIntervalHours: z.number().int().min(1).max(168).default(24),
  entitySyncIntervalMinutes: z.number().int().min(15).max(1440).default(60),
});

export const SMTP_ENCRYPTIONS = ['NONE', 'SSL', 'STARTTLS'] as const;
export const smtpSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  host: z.string().trim().max(255).default(''),
  port: z.number().int().min(1).max(65535).default(587),
  username: z.string().trim().max(255).default(''),
  encryption: z.enum(SMTP_ENCRYPTIONS).default('STARTTLS'),
  fromEmail: z.union([z.email(), z.literal('')]).default(''),
  fromName: z.string().trim().max(100).default('AdPilot'),
});

export const TELEGRAM_MODES = ['POLLING', 'WEBHOOK'] as const;
export const telegramSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  botUsername: z
    .string()
    .trim()
    .max(64)
    .regex(/^$|^[A-Za-z0-9_]{5,64}$/, 'Bot username without @')
    .default(''),
  mode: z.enum(TELEGRAM_MODES).default('POLLING'),
});

export const queueSettingsSchema = z.object({
  launchConcurrency: z.number().int().min(1).max(50).default(3),
  statisticsConcurrency: z.number().int().min(1).max(50).default(4),
  accountStatusConcurrency: z.number().int().min(1).max(50).default(4),
  metaSyncConcurrency: z.number().int().min(1).max(50).default(3),
  creativeUploadConcurrency: z.number().int().min(1).max(20).default(2),
  rulesConcurrency: z.number().int().min(1).max(50).default(4),
  notificationConcurrency: z.number().int().min(1).max(50).default(5),
  bulkConcurrency: z.number().int().min(1).max(20).default(2),
  maxJobAttempts: z.number().int().min(1).max(20).default(6),
});

export const retentionSettingsSchema = z.object({
  metaApiLogsDays: z.number().int().min(1).max(3650).default(30),
  systemLogsDays: z.number().int().min(1).max(3650).default(30),
  auditLogsDays: z.number().int().min(30).max(3650).default(365),
  notificationsDays: z.number().int().min(7).max(3650).default(90),
  loginEventsDays: z.number().int().min(7).max(3650).default(180),
  statisticsDays: z.number().int().min(30).max(3650).default(760),
  launchJobsDays: z.number().int().min(7).max(3650).default(180),
  ruleExecutionsDays: z.number().int().min(7).max(3650).default(180),
  completedQueueJobsHours: z.number().int().min(1).max(720).default(24),
});

export const maintenanceSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  message: z.string().trim().max(500).default('The platform is under maintenance. Please try again later.'),
});

export const backupSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  hourUtc: z.number().int().min(0).max(23).default(3),
  keepLast: z.number().int().min(1).max(365).default(14),
});

export const SETTINGS_SCHEMAS = {
  general: generalSettingsSchema,
  security: securitySettingsSchema,
  files: fileSettingsSchema,
  statistics: statisticsSettingsSchema,
  accountChecks: accountCheckSettingsSchema,
  rules: rulesSettingsSchema,
  meta: metaSettingsSchema,
  smtp: smtpSettingsSchema,
  telegram: telegramSettingsSchema,
  queue: queueSettingsSchema,
  retention: retentionSettingsSchema,
  maintenance: maintenanceSettingsSchema,
  backups: backupSettingsSchema,
} as const;

export type SettingKey = keyof typeof SETTINGS_SCHEMAS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS_SCHEMAS)[K]>;
export const SETTING_KEYS = Object.keys(SETTINGS_SCHEMAS) as SettingKey[];

/** Secret fields per setting key. They are write-only through the API. */
export const SECRET_SETTING_FIELDS: Partial<Record<SettingKey, readonly string[]>> = {
  smtp: ['password'],
  telegram: ['botToken', 'webhookSecret'],
  meta: ['appSecret'],
};

/** Which permission is needed to change each settings group. */
export const SETTING_PERMISSIONS: Record<SettingKey, string> = {
  general: 'admin.settings.manage',
  security: 'admin.security.manage',
  files: 'admin.storage.manage',
  statistics: 'admin.settings.manage',
  accountChecks: 'admin.settings.manage',
  rules: 'admin.settings.manage',
  meta: 'admin.meta.manage',
  smtp: 'admin.smtp.manage',
  telegram: 'admin.telegram.manage',
  queue: 'admin.settings.manage',
  retention: 'admin.maintenance.manage',
  maintenance: 'admin.maintenance.manage',
  backups: 'admin.backups.manage',
};

export function defaultSettings<K extends SettingKey>(key: K): SettingValue<K> {
  return SETTINGS_SCHEMAS[key].parse({}) as SettingValue<K>;
}
