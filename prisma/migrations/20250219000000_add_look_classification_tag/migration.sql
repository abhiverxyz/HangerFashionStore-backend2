-- CreateTable
CREATE TABLE "LookClassificationTag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LookClassificationTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LookClassificationTag_name_key" ON "LookClassificationTag"("name");

-- CreateIndex
CREATE INDEX "LookClassificationTag_sortOrder_idx" ON "LookClassificationTag"("sortOrder");
