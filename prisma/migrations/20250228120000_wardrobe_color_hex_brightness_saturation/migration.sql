-- AlterTable
ALTER TABLE "Wardrobe" ADD COLUMN "colorHex" TEXT;
ALTER TABLE "Wardrobe" ADD COLUMN "colorBrightness" TEXT;
ALTER TABLE "Wardrobe" ADD COLUMN "colorSaturation" TEXT;
ALTER TABLE "Wardrobe" ADD COLUMN "colorSaturationPercent" DOUBLE PRECISION;
ALTER TABLE "Wardrobe" ADD COLUMN "colorLightnessPercent" DOUBLE PRECISION;
ALTER TABLE "Wardrobe" ADD COLUMN "colorIsNeutral" BOOLEAN;
