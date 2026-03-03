-- AlterTable StyleReportSettings: add styleIdentityOptions for Style Identity card word lists
ALTER TABLE "StyleReportSettings" ADD COLUMN IF NOT EXISTS "styleIdentityOptions" JSONB;
