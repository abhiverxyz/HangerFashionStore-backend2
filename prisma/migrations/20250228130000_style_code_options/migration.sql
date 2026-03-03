-- AlterTable StyleReportSettings: add styleCodeOptions for Style Code card dimensions (id, labelLeft, labelRight)
ALTER TABLE "StyleReportSettings" ADD COLUMN IF NOT EXISTS "styleCodeOptions" JSONB;
