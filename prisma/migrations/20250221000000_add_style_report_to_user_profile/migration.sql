-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "latestStyleReportData" JSONB;
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "latestStyleReportGeneratedAt" TIMESTAMP(3);
