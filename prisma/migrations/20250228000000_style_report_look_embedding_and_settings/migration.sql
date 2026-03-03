-- AlterTable Look: add embedding fields for style profile
ALTER TABLE "Look" ADD COLUMN "embedding" TEXT;
ALTER TABLE "Look" ADD COLUMN "embeddingGeneratedAt" TIMESTAMP(3);

-- AlterTable StyleReportSettings: agent objective and card config
ALTER TABLE "StyleReportSettings" ADD COLUMN "agentObjective" TEXT;
ALTER TABLE "StyleReportSettings" ADD COLUMN "cardConfig" JSONB;
