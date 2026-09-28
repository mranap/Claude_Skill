-- AlterTable
ALTER TABLE "ad_accounts" ADD COLUMN     "minCampaignGroupSpendCap" BIGINT;

-- AlterTable
ALTER TABLE "launch_job_items" ADD COLUMN     "deferredSince" TIMESTAMP(3);
