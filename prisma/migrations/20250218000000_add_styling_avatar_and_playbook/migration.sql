-- CreateTable
CREATE TABLE "StylingAvatar" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "systemPromptAddition" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StylingAvatar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StylingAgentPlaybook" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StylingAgentPlaybook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StylingAvatar_slug_key" ON "StylingAvatar"("slug");

-- CreateIndex
CREATE INDEX "StylingAvatar_slug_idx" ON "StylingAvatar"("slug");

-- CreateIndex
CREATE INDEX "StylingAvatar_isDefault_idx" ON "StylingAvatar"("isDefault");

-- CreateIndex
CREATE INDEX "StylingAgentPlaybook_type_idx" ON "StylingAgentPlaybook"("type");

-- CreateIndex
CREATE INDEX "StylingAgentPlaybook_isActive_idx" ON "StylingAgentPlaybook"("isActive");
