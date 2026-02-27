-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "personalInsight" TEXT;
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "personalInsightUpdatedAt" TIMESTAMP(3);
