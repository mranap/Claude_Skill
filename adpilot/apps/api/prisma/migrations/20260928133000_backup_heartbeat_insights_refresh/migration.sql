-- AlterTable
ALTER TABLE "backups" ADD COLUMN     "heartbeatAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ad_accounts" ADD COLUMN     "statsFullRefreshAt" TIMESTAMP(3);

-- Accounts that already have statistics get their first 28-day refresh at a random point of the coming
-- week instead of all at once right after the deployment (spreads the extra Insights load).
UPDATE "ad_accounts"
SET "statsFullRefreshAt" = (now() AT TIME ZONE 'UTC') - random() * interval '7 days'
WHERE "statsBackfilledAt" IS NOT NULL;
