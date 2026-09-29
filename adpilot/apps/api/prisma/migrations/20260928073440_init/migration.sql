-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('AD_ACCOUNT_STATUS_CHANGED', 'TOKEN_EXPIRED', 'TOKEN_REVOKED', 'TOKEN_EXPIRING_SOON', 'CAMPAIGN_STOPPED', 'CAMPAIGN_LAUNCHED', 'AD_REJECTED', 'AUTO_RULE_TRIGGERED', 'BUDGET_CHANGED', 'CAMPAIGN_CREATION_FAILED', 'STATISTICS_SYNC_FAILED', 'ACCOUNT_SYNC_FAILED', 'SECURITY_ALERT', 'SYSTEM_MESSAGE');

-- CreateEnum
CREATE TYPE "NotificationChannelPref" AS ENUM ('EMAIL', 'TELEGRAM', 'BOTH', 'OFF');

-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('EMAIL', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "ProxyType" AS ENUM ('HTTP', 'HTTPS', 'SOCKS5');

-- CreateEnum
CREATE TYPE "MetaProfileStatus" AS ENUM ('UNCHECKED', 'ACTIVE', 'EXPIRED', 'INVALID', 'PERMISSION_REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "TokenType" AS ENUM ('USER', 'SYSTEM_USER', 'PAGE', 'APP', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('IDLE', 'QUEUED', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "AdAccountStatusKey" AS ENUM ('ACTIVE', 'DISABLED', 'UNSETTLED', 'PENDING_RISK_REVIEW', 'PENDING_SETTLEMENT', 'IN_GRACE_PERIOD', 'PENDING_CLOSURE', 'CLOSED', 'ANY_ACTIVE', 'ANY_CLOSED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CreativeType" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "CreativeFileStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "MetaAssetStatus" AS ENUM ('PENDING', 'UPLOADING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('DRAFT', 'LAUNCHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LaunchJobStatus" AS ENUM ('QUEUED', 'VALIDATING', 'UPLOADING_CREATIVES', 'CREATING_CAMPAIGN', 'CREATING_ADSETS', 'CREATING_ADS', 'VERIFYING', 'ACTIVATING', 'COMPLETED', 'PARTIAL_FAILURE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LaunchItemKind" AS ENUM ('MEDIA_IMAGE', 'MEDIA_VIDEO', 'CAMPAIGN', 'ADSET', 'CREATIVE', 'AD');

-- CreateEnum
CREATE TYPE "LaunchItemStatus" AS ENUM ('PENDING', 'IN_FLIGHT', 'CREATED', 'VERIFIED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "EntityLevel" AS ENUM ('ACCOUNT', 'CAMPAIGN', 'ADSET', 'AD');

-- CreateEnum
CREATE TYPE "RuleAction" AS ENUM ('PAUSE', 'START', 'INCREASE_BUDGET', 'DECREASE_BUDGET', 'SET_BUDGET', 'NOTIFY_ONLY');

-- CreateEnum
CREATE TYPE "RuleTimeRange" AS ENUM ('TODAY', 'YESTERDAY', 'LAST_N_HOURS', 'LAST_N_DAYS');

-- CreateEnum
CREATE TYPE "RuleExecutionResult" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'SKIPPED', 'DRY_RUN', 'NOTIFIED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "BroadcastAudience" AS ENUM ('ALL', 'SELECTED');

-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "roleId" UUID NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "passwordChangedAt" TIMESTAMP(3),
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecretEnc" TEXT,
    "twoFactorPendingSecretEnc" TEXT,
    "twoFactorRecoveryHashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "blockedAt" TIMESTAMP(3),
    "blockedReason" TEXT,
    "deletedAt" TIMESTAMP(3),
    "storageUsedBytes" BIGINT NOT NULL DEFAULT 0,
    "storageQuotaBytes" BIGINT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "previousRefreshHash" TEXT,
    "rotatedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'RESET',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "requestedIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_change_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "newEmail" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_change_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_events" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "email" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannelPref" NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_connections" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "chatId" TEXT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastError" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_link_codes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_link_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "data" JSONB,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "channel" "DeliveryChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcasts" (
    "id" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channels" "DeliveryChannel"[],
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "audience" "BroadcastAudience" NOT NULL,
    "userIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "status" "JobRunStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proxies" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "ProxyType" NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "username" TEXT,
    "passwordEnc" TEXT,
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastTestError" TEXT,
    "lastTestIp" TEXT,
    "lastTestLatencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proxies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "status" "MetaProfileStatus" NOT NULL DEFAULT 'UNCHECKED',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "tokenEnc" TEXT,
    "tokenMask" TEXT NOT NULL,
    "tokenFingerprint" TEXT NOT NULL,
    "tokenType" "TokenType" NOT NULL DEFAULT 'UNKNOWN',
    "tokenExpiresAt" TIMESTAMP(3),
    "dataAccessExpiresAt" TIMESTAMP(3),
    "tokenScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tokenAppId" TEXT,
    "metaUserId" TEXT,
    "metaUserName" TEXT,
    "appId" TEXT,
    "appSecretEnc" TEXT,
    "proxyId" UUID,
    "lastValidatedAt" TIMESTAMP(3),
    "lastValidationError" TEXT,
    "lastErrorCode" INTEGER,
    "expiryWarnedAt" TIMESTAMP(3),
    "nextTokenCheckAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "nextAssetSyncAt" TIMESTAMP(3),
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'IDLE',
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "meta_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_accounts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "metaBusinessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "verificationStatus" TEXT,
    "isSelected" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_accounts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "businessId" UUID,
    "metaBusinessId" TEXT,
    "metaBusinessName" TEXT,
    "metaAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "timezoneName" TEXT NOT NULL,
    "timezoneOffsetHours" DECIMAL(5,2),
    "accountStatus" INTEGER,
    "statusKey" "AdAccountStatusKey" NOT NULL DEFAULT 'UNKNOWN',
    "disableReason" INTEGER,
    "amountSpent" BIGINT,
    "balance" BIGINT,
    "spendCap" BIGINT,
    "minDailyBudget" BIGINT,
    "isPrepayAccount" BOOLEAN,
    "fundingSourceDetails" JSONB,
    "defaultDsaPayor" TEXT,
    "defaultDsaBeneficiary" TEXT,
    "isConnected" BOOLEAN NOT NULL DEFAULT false,
    "statusCheckIntervalMinutes" INTEGER NOT NULL DEFAULT 180,
    "nextStatusCheckAt" TIMESTAMP(3),
    "lastStatusCheckAt" TIMESTAMP(3),
    "statusCheckError" TEXT,
    "statsSyncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "statsSyncIntervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "nextStatsSyncAt" TIMESTAMP(3),
    "lastStatsSyncAt" TIMESTAMP(3),
    "statsSyncStatus" "SyncStatus" NOT NULL DEFAULT 'IDLE',
    "statsSyncError" TEXT,
    "statsBackfilledAt" TIMESTAMP(3),
    "lastManualRefreshAt" TIMESTAMP(3),
    "entitiesSyncedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_status_history" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "adAccountId" UUID NOT NULL,
    "fromStatus" INTEGER,
    "toStatus" INTEGER,
    "fromKey" "AdAccountStatusKey",
    "toKey" "AdAccountStatusKey" NOT NULL,
    "disableReason" INTEGER,
    "notificationId" UUID,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "metaPageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "pictureUrl" TEXT,
    "instagramUserId" TEXT,
    "instagramUsername" TEXT,
    "source" TEXT NOT NULL,
    "isSelected" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pixels" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "adAccountId" UUID NOT NULL,
    "metaPixelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lastFiredTime" TIMESTAMP(3),
    "isUnavailable" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pixels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_audiences" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "adAccountId" UUID NOT NULL,
    "metaAudienceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subtype" TEXT,
    "approximateCountMin" BIGINT,
    "approximateCountMax" BIGINT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_audiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_files" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "CreativeType" NOT NULL,
    "status" "CreativeFileStatus" NOT NULL DEFAULT 'PROCESSING',
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "aspectRatio" TEXT,
    "videoCodec" TEXT,
    "audioCodec" TEXT,
    "frameRate" DECIMAL(8,3),
    "bitrate" INTEGER,
    "error" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "creative_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_meta_assets" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "creativeFileId" UUID NOT NULL,
    "adAccountId" UUID NOT NULL,
    "status" "MetaAssetStatus" NOT NULL DEFAULT 'PENDING',
    "metaImageHash" TEXT,
    "metaImageUrl" TEXT,
    "metaVideoId" TEXT,
    "uploadSessionId" TEXT,
    "thumbnailUrl" TEXT,
    "error" TEXT,
    "errorCode" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creative_meta_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_templates" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "objective" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "clonedFromId" UUID,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "launch_drafts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "templateId" UUID,
    "profileId" UUID,
    "adAccountId" UUID,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'DRAFT',
    "clonedFromId" UUID,
    "lastValidatedAt" TIMESTAMP(3),
    "validationResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "launch_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "launch_jobs" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "draftId" UUID,
    "templateId" UUID,
    "profileId" UUID NOT NULL,
    "adAccountId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "LaunchJobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "plan" JSONB NOT NULL,
    "summary" JSONB,
    "error" JSONB,
    "warnings" JSONB,
    "activateOnSuccess" BOOLEAN NOT NULL DEFAULT false,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "createdItems" INTEGER NOT NULL DEFAULT 0,
    "failedItems" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "metaCampaignId" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "launch_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "launch_job_items" (
    "id" UUID NOT NULL,
    "launchJobId" UUID NOT NULL,
    "kind" "LaunchItemKind" NOT NULL,
    "key" TEXT NOT NULL,
    "parentKey" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "status" "LaunchItemStatus" NOT NULL DEFAULT 'PENDING',
    "metaId" TEXT,
    "request" JSONB,
    "response" JSONB,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "inFlightSince" TIMESTAMP(3),
    "lastError" JSONB,
    "errorCategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "launch_job_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "adAccountId" UUID NOT NULL,
    "metaCampaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "status" TEXT,
    "effectiveStatus" TEXT,
    "dailyBudget" BIGINT,
    "lifetimeBudget" BIGINT,
    "budgetRemaining" BIGINT,
    "spendCap" BIGINT,
    "bidStrategy" TEXT,
    "buyingType" TEXT,
    "specialAdCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "budgetSharing" BOOLEAN,
    "startTime" TIMESTAMP(3),
    "stopTime" TIMESTAMP(3),
    "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "issuesInfo" JSONB,
    "metaCreatedTime" TIMESTAMP(3),
    "metaUpdatedTime" TIMESTAMP(3),
    "launchJobId" UUID,
    "templateId" UUID,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_sets" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "adAccountId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "metaAdSetId" TEXT NOT NULL,
    "metaCampaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "effectiveStatus" TEXT,
    "dailyBudget" BIGINT,
    "lifetimeBudget" BIGINT,
    "budgetRemaining" BIGINT,
    "optimizationGoal" TEXT,
    "billingEvent" TEXT,
    "bidStrategy" TEXT,
    "bidAmount" BIGINT,
    "destinationType" TEXT,
    "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targeting" JSONB,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "issuesInfo" JSONB,
    "metaCreatedTime" TIMESTAMP(3),
    "metaUpdatedTime" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "adAccountId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "adSetId" UUID NOT NULL,
    "metaAdId" TEXT NOT NULL,
    "metaAdSetId" TEXT NOT NULL,
    "metaCampaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "effectiveStatus" TEXT,
    "metaCreativeId" TEXT,
    "reviewFeedback" JSONB,
    "issuesInfo" JSONB,
    "metaCreatedTime" TIMESTAMP(3),
    "metaUpdatedTime" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insights_daily" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "adAccountId" UUID NOT NULL,
    "level" "EntityLevel" NOT NULL,
    "metaObjectId" TEXT NOT NULL,
    "metaCampaignId" TEXT,
    "metaAdSetId" TEXT,
    "objectName" TEXT,
    "date" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "spend" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "reach" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "linkClicks" BIGINT NOT NULL DEFAULT 0,
    "leads" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "purchases" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "purchaseValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "results" DECIMAL(18,2),
    "resultType" TEXT,
    "actions" JSONB,
    "actionValues" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insights_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_rules" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDryRun" BOOLEAN NOT NULL DEFAULT false,
    "targetLevel" "EntityLevel" NOT NULL,
    "scope" JSONB NOT NULL,
    "conditions" JSONB NOT NULL,
    "timeRange" "RuleTimeRange" NOT NULL,
    "timeRangeValue" INTEGER,
    "action" "RuleAction" NOT NULL,
    "actionValue" DECIMAL(18,4),
    "actionValueType" TEXT,
    "currency" TEXT,
    "maxBudgetChangePercent" DECIMAL(7,2),
    "minBudget" DECIMAL(18,2),
    "maxBudget" DECIMAL(18,2),
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 360,
    "maxActionsPerDay" INTEGER NOT NULL DEFAULT 3,
    "checkIntervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "notify" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "lastRunError" TEXT,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "auto_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_rule_executions" (
    "id" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "runId" TEXT NOT NULL,
    "adAccountId" UUID,
    "entityLevel" "EntityLevel" NOT NULL,
    "entityMetaId" TEXT NOT NULL,
    "entityName" TEXT,
    "action" "RuleAction" NOT NULL,
    "result" "RuleExecutionResult" NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "conditionData" JSONB NOT NULL,
    "reason" TEXT,
    "metaResponse" JSONB,
    "errorMessage" TEXT,
    "errorCode" INTEGER,
    "isDryRun" BOOLEAN NOT NULL DEFAULT false,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_rule_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_operations" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "level" "EntityLevel" NOT NULL,
    "action" TEXT NOT NULL,
    "params" JSONB,
    "targetIds" TEXT[],
    "status" "JobRunStatus" NOT NULL DEFAULT 'QUEUED',
    "total" INTEGER NOT NULL DEFAULT 0,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "results" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "bulk_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_events" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "adAccountId" UUID,
    "entityLevel" "EntityLevel",
    "entityMetaId" TEXT,
    "entityName" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" JSONB,
    "source" TEXT NOT NULL,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorType" "ActorType" NOT NULL DEFAULT 'USER',
    "actorUserId" UUID,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "subjectUserId" UUID,
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_api_logs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "profileId" UUID,
    "metaAccountId" TEXT,
    "method" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "errorCode" INTEGER,
    "errorSubcode" INTEGER,
    "errorType" TEXT,
    "errorMessage" TEXT,
    "fbtraceId" TEXT,
    "durationMs" INTEGER NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "rateLimited" BOOLEAN NOT NULL DEFAULT false,
    "usage" JSONB,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_api_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_logs" (
    "id" UUID NOT NULL,
    "level" "LogLevel" NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "userId" UUID,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "backups" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "JobRunStatus" NOT NULL DEFAULT 'QUEUED',
    "storageKey" TEXT,
    "sizeBytes" BIGINT,
    "error" TEXT,
    "triggeredById" UUID,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "backups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "sessions"("refreshTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_previousRefreshHash_key" ON "sessions"("previousRefreshHash");

-- CreateIndex
CREATE INDEX "sessions_userId_revokedAt_idx" ON "sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_createdAt_idx" ON "password_reset_tokens"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_change_tokens_tokenHash_key" ON "email_change_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "email_change_tokens_userId_idx" ON "email_change_tokens"("userId");

-- CreateIndex
CREATE INDEX "login_events_userId_createdAt_idx" ON "login_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "login_events_createdAt_idx" ON "login_events"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_type_key" ON "notification_preferences"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_connections_userId_key" ON "telegram_connections"("userId");

-- CreateIndex
CREATE INDEX "telegram_connections_chatId_idx" ON "telegram_connections"("chatId");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_link_codes_codeHash_key" ON "telegram_link_codes"("codeHash");

-- CreateIndex
CREATE INDEX "telegram_link_codes_userId_idx" ON "telegram_link_codes"("userId");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_userId_dedupeKey_key" ON "notifications"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_createdAt_idx" ON "notification_deliveries"("status", "createdAt");

-- CreateIndex
CREATE INDEX "notification_deliveries_userId_createdAt_idx" ON "notification_deliveries"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_notificationId_channel_key" ON "notification_deliveries"("notificationId", "channel");

-- CreateIndex
CREATE INDEX "broadcasts_createdAt_idx" ON "broadcasts"("createdAt");

-- CreateIndex
CREATE INDEX "proxies_userId_idx" ON "proxies"("userId");

-- CreateIndex
CREATE INDEX "meta_profiles_userId_deletedAt_idx" ON "meta_profiles"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "meta_profiles_userId_tokenFingerprint_idx" ON "meta_profiles"("userId", "tokenFingerprint");

-- CreateIndex
CREATE INDEX "meta_profiles_nextTokenCheckAt_idx" ON "meta_profiles"("nextTokenCheckAt");

-- CreateIndex
CREATE INDEX "meta_profiles_nextAssetSyncAt_idx" ON "meta_profiles"("nextAssetSyncAt");

-- CreateIndex
CREATE INDEX "business_accounts_userId_idx" ON "business_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "business_accounts_profileId_metaBusinessId_key" ON "business_accounts"("profileId", "metaBusinessId");

-- CreateIndex
CREATE INDEX "ad_accounts_userId_isConnected_idx" ON "ad_accounts"("userId", "isConnected");

-- CreateIndex
CREATE INDEX "ad_accounts_userId_metaAccountId_idx" ON "ad_accounts"("userId", "metaAccountId");

-- CreateIndex
CREATE INDEX "ad_accounts_isConnected_nextStatusCheckAt_idx" ON "ad_accounts"("isConnected", "nextStatusCheckAt");

-- CreateIndex
CREATE INDEX "ad_accounts_isConnected_nextStatsSyncAt_idx" ON "ad_accounts"("isConnected", "nextStatsSyncAt");

-- CreateIndex
CREATE UNIQUE INDEX "ad_accounts_profileId_metaAccountId_key" ON "ad_accounts"("profileId", "metaAccountId");

-- CreateIndex
CREATE INDEX "account_status_history_adAccountId_detectedAt_idx" ON "account_status_history"("adAccountId", "detectedAt");

-- CreateIndex
CREATE INDEX "account_status_history_userId_detectedAt_idx" ON "account_status_history"("userId", "detectedAt");

-- CreateIndex
CREATE INDEX "pages_userId_idx" ON "pages"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "pages_profileId_metaPageId_key" ON "pages"("profileId", "metaPageId");

-- CreateIndex
CREATE INDEX "pixels_userId_idx" ON "pixels"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "pixels_adAccountId_metaPixelId_key" ON "pixels"("adAccountId", "metaPixelId");

-- CreateIndex
CREATE INDEX "custom_audiences_userId_idx" ON "custom_audiences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "custom_audiences_adAccountId_metaAudienceId_key" ON "custom_audiences"("adAccountId", "metaAudienceId");

-- CreateIndex
CREATE UNIQUE INDEX "creative_files_storageKey_key" ON "creative_files"("storageKey");

-- CreateIndex
CREATE INDEX "creative_files_userId_deletedAt_createdAt_idx" ON "creative_files"("userId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "creative_files_userId_sha256_idx" ON "creative_files"("userId", "sha256");

-- CreateIndex
CREATE INDEX "creative_meta_assets_userId_idx" ON "creative_meta_assets"("userId");

-- CreateIndex
CREATE INDEX "creative_meta_assets_status_lastCheckedAt_idx" ON "creative_meta_assets"("status", "lastCheckedAt");

-- CreateIndex
CREATE UNIQUE INDEX "creative_meta_assets_creativeFileId_adAccountId_key" ON "creative_meta_assets"("creativeFileId", "adAccountId");

-- CreateIndex
CREATE INDEX "campaign_templates_userId_isArchived_updatedAt_idx" ON "campaign_templates"("userId", "isArchived", "updatedAt");

-- CreateIndex
CREATE INDEX "launch_drafts_userId_status_updatedAt_idx" ON "launch_drafts"("userId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "launch_jobs_userId_createdAt_idx" ON "launch_jobs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "launch_jobs_status_updatedAt_idx" ON "launch_jobs"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "launch_jobs_userId_idempotencyKey_key" ON "launch_jobs"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "launch_jobs_code_key" ON "launch_jobs"("code");

-- CreateIndex
CREATE INDEX "launch_job_items_launchJobId_kind_status_idx" ON "launch_job_items"("launchJobId", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "launch_job_items_launchJobId_key_key" ON "launch_job_items"("launchJobId", "key");

-- CreateIndex
CREATE INDEX "campaigns_userId_isDeleted_effectiveStatus_idx" ON "campaigns"("userId", "isDeleted", "effectiveStatus");

-- CreateIndex
CREATE INDEX "campaigns_userId_templateId_idx" ON "campaigns"("userId", "templateId");

-- CreateIndex
CREATE INDEX "campaigns_metaCampaignId_idx" ON "campaigns"("metaCampaignId");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_adAccountId_metaCampaignId_key" ON "campaigns"("adAccountId", "metaCampaignId");

-- CreateIndex
CREATE INDEX "ad_sets_userId_isDeleted_effectiveStatus_idx" ON "ad_sets"("userId", "isDeleted", "effectiveStatus");

-- CreateIndex
CREATE INDEX "ad_sets_campaignId_idx" ON "ad_sets"("campaignId");

-- CreateIndex
CREATE INDEX "ad_sets_metaAdSetId_idx" ON "ad_sets"("metaAdSetId");

-- CreateIndex
CREATE UNIQUE INDEX "ad_sets_adAccountId_metaAdSetId_key" ON "ad_sets"("adAccountId", "metaAdSetId");

-- CreateIndex
CREATE INDEX "ads_userId_isDeleted_effectiveStatus_idx" ON "ads"("userId", "isDeleted", "effectiveStatus");

-- CreateIndex
CREATE INDEX "ads_adSetId_idx" ON "ads"("adSetId");

-- CreateIndex
CREATE INDEX "ads_metaAdId_idx" ON "ads"("metaAdId");

-- CreateIndex
CREATE UNIQUE INDEX "ads_adAccountId_metaAdId_key" ON "ads"("adAccountId", "metaAdId");

-- CreateIndex
CREATE INDEX "insights_daily_userId_level_date_idx" ON "insights_daily"("userId", "level", "date");

-- CreateIndex
CREATE INDEX "insights_daily_adAccountId_level_date_idx" ON "insights_daily"("adAccountId", "level", "date");

-- CreateIndex
CREATE INDEX "insights_daily_metaCampaignId_date_idx" ON "insights_daily"("metaCampaignId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "insights_daily_adAccountId_level_metaObjectId_date_key" ON "insights_daily"("adAccountId", "level", "metaObjectId", "date");

-- CreateIndex
CREATE INDEX "auto_rules_isActive_nextRunAt_idx" ON "auto_rules"("isActive", "nextRunAt");

-- CreateIndex
CREATE INDEX "auto_rules_userId_deletedAt_idx" ON "auto_rules"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "auto_rule_executions_ruleId_executedAt_idx" ON "auto_rule_executions"("ruleId", "executedAt");

-- CreateIndex
CREATE INDEX "auto_rule_executions_ruleId_entityMetaId_executedAt_idx" ON "auto_rule_executions"("ruleId", "entityMetaId", "executedAt");

-- CreateIndex
CREATE INDEX "auto_rule_executions_userId_executedAt_idx" ON "auto_rule_executions"("userId", "executedAt");

-- CreateIndex
CREATE INDEX "bulk_operations_userId_createdAt_idx" ON "bulk_operations"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "bulk_operations_userId_idempotencyKey_key" ON "bulk_operations"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "activity_events_userId_createdAt_idx" ON "activity_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "activity_events_adAccountId_createdAt_idx" ON "activity_events"("adAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "activity_events_entityMetaId_createdAt_idx" ON "activity_events"("entityMetaId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_subjectUserId_createdAt_idx" ON "audit_logs"("subjectUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "meta_api_logs_createdAt_idx" ON "meta_api_logs"("createdAt");

-- CreateIndex
CREATE INDEX "meta_api_logs_userId_createdAt_idx" ON "meta_api_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "meta_api_logs_errorCode_createdAt_idx" ON "meta_api_logs"("errorCode", "createdAt");

-- CreateIndex
CREATE INDEX "system_logs_createdAt_idx" ON "system_logs"("createdAt");

-- CreateIndex
CREATE INDEX "system_logs_level_createdAt_idx" ON "system_logs"("level", "createdAt");

-- CreateIndex
CREATE INDEX "system_logs_source_createdAt_idx" ON "system_logs"("source", "createdAt");

-- CreateIndex
CREATE INDEX "backups_startedAt_idx" ON "backups"("startedAt");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_change_tokens" ADD CONSTRAINT "email_change_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_connections" ADD CONSTRAINT "telegram_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proxies" ADD CONSTRAINT "proxies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_profiles" ADD CONSTRAINT "meta_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_profiles" ADD CONSTRAINT "meta_profiles_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "proxies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_accounts" ADD CONSTRAINT "business_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_accounts" ADD CONSTRAINT "business_accounts_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "meta_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "meta_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "business_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_status_history" ADD CONSTRAINT "account_status_history_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "meta_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pixels" ADD CONSTRAINT "pixels_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pixels" ADD CONSTRAINT "pixels_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_audiences" ADD CONSTRAINT "custom_audiences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_audiences" ADD CONSTRAINT "custom_audiences_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_files" ADD CONSTRAINT "creative_files_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_meta_assets" ADD CONSTRAINT "creative_meta_assets_creativeFileId_fkey" FOREIGN KEY ("creativeFileId") REFERENCES "creative_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_meta_assets" ADD CONSTRAINT "creative_meta_assets_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_templates" ADD CONSTRAINT "campaign_templates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "launch_drafts" ADD CONSTRAINT "launch_drafts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "launch_drafts" ADD CONSTRAINT "launch_drafts_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "campaign_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "launch_jobs" ADD CONSTRAINT "launch_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "launch_jobs" ADD CONSTRAINT "launch_jobs_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "launch_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "launch_jobs" ADD CONSTRAINT "launch_jobs_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "campaign_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "launch_jobs" ADD CONSTRAINT "launch_jobs_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "meta_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "launch_jobs" ADD CONSTRAINT "launch_jobs_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "launch_job_items" ADD CONSTRAINT "launch_job_items_launchJobId_fkey" FOREIGN KEY ("launchJobId") REFERENCES "launch_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "ads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "ads_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "ads_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ads" ADD CONSTRAINT "ads_adSetId_fkey" FOREIGN KEY ("adSetId") REFERENCES "ad_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insights_daily" ADD CONSTRAINT "insights_daily_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_rules" ADD CONSTRAINT "auto_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_rule_executions" ADD CONSTRAINT "auto_rule_executions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "auto_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_operations" ADD CONSTRAINT "bulk_operations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Custom SQL (not expressible in the Prisma schema)
-- ─────────────────────────────────────────────────────────────────────────────

-- Audit log is append-only: rows can be inserted and (by the retention job) deleted, never modified.
CREATE OR REPLACE FUNCTION audit_logs_block_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_update();

-- Case-insensitive lookups by e-mail are always done on the normalised (lower-case) value; enforce it.
ALTER TABLE "users" ADD CONSTRAINT users_email_lowercase CHECK ("email" = lower("email"));

-- Money and counters are never negative.
ALTER TABLE "insights_daily" ADD CONSTRAINT insights_daily_non_negative
  CHECK ("spend" >= 0 AND "impressions" >= 0 AND "clicks" >= 0 AND "linkClicks" >= 0);
ALTER TABLE "users" ADD CONSTRAINT users_storage_non_negative CHECK ("storageUsedBytes" >= 0);
