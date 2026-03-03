-- CreateTable
CREATE TABLE "CachedGeneratedImage" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "storageKey" TEXT,
    "vibe" TEXT,
    "occasion" TEXT,
    "ideaDescription" TEXT,
    "name" TEXT,
    "description" TEXT,
    "categories" TEXT,
    "trends" TEXT,
    "lookData" TEXT,
    "imageStyle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CachedGeneratedImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CachedGeneratedImage_sourceType_idx" ON "CachedGeneratedImage"("sourceType");

-- CreateIndex
CREATE INDEX "CachedGeneratedImage_sourceType_vibe_occasion_imageStyle_idx" ON "CachedGeneratedImage"("sourceType", "vibe", "occasion", "imageStyle");

-- CreateIndex
CREATE INDEX "CachedGeneratedImage_sourceType_ideaDescription_idx" ON "CachedGeneratedImage"("sourceType", "ideaDescription");

-- CreateIndex
CREATE INDEX "CachedGeneratedImage_sourceType_name_vibe_idx" ON "CachedGeneratedImage"("sourceType", "name", "vibe");
