-- CreateTable
CREATE TABLE IF NOT EXISTS "StyleReportSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "minLooks" INTEGER NOT NULL DEFAULT 1,
    "maxLooks" INTEGER NOT NULL DEFAULT 15,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StyleReportSettings_pkey" PRIMARY KEY ("id")
);

-- Insert default row if not exists
INSERT INTO "StyleReportSettings" ("id", "minLooks", "maxLooks", "updatedAt")
SELECT 'default', 1, 15, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "StyleReportSettings" WHERE "id" = 'default');
