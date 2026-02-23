-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "preferenceGraphJson" JSONB;
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "preferenceGraphUpdatedAt" TIMESTAMP(3);
