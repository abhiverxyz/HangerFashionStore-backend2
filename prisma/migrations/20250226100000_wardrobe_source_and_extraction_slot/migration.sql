-- AlterTable
ALTER TABLE "Wardrobe" ADD COLUMN "source" TEXT;
ALTER TABLE "Wardrobe" ADD COLUMN "extractionId" TEXT;
ALTER TABLE "Wardrobe" ADD COLUMN "extractionSlotIndex" INTEGER;

-- CreateIndex
CREATE INDEX "Wardrobe_userId_extractionId_extractionSlotIndex_idx" ON "Wardrobe"("userId", "extractionId", "extractionSlotIndex");
