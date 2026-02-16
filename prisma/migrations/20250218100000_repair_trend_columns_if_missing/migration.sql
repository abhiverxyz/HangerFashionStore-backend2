-- Repair: ensure Trend has impactedItemTypes and tellTaleSigns (if migration 20250216000000 was skipped or failed)
ALTER TABLE "Trend" ADD COLUMN IF NOT EXISTS "impactedItemTypes" TEXT;
ALTER TABLE "Trend" ADD COLUMN IF NOT EXISTS "tellTaleSigns" TEXT;
