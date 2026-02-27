-- CreateTable
CREATE TABLE "WardrobeExtraction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lookId" TEXT,
    "imageUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "slots" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WardrobeExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WardrobeExtraction_userId_idx" ON "WardrobeExtraction"("userId");

-- CreateIndex
CREATE INDEX "WardrobeExtraction_userId_status_idx" ON "WardrobeExtraction"("userId", "status");

-- AddForeignKey
ALTER TABLE "WardrobeExtraction" ADD CONSTRAINT "WardrobeExtraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
