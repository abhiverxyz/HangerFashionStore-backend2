-- CreateTable
CREATE TABLE "StylingSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'live_styling',
    "entryPoint" TEXT,
    "device" JSONB,
    "currentState" TEXT NOT NULL,
    "stateHistory" JSONB NOT NULL DEFAULT '[]',
    "messages" JSONB NOT NULL DEFAULT '[]',
    "lastAnalysisId" TEXT,
    "outputs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StylingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisionAnalysis" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "signals" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisionAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StylingSession_userId_idx" ON "StylingSession"("userId");

-- CreateIndex
CREATE INDEX "StylingSession_currentState_idx" ON "StylingSession"("currentState");

-- CreateIndex
CREATE INDEX "StylingSession_createdAt_idx" ON "StylingSession"("createdAt");

-- CreateIndex
CREATE INDEX "VisionAnalysis_sessionId_idx" ON "VisionAnalysis"("sessionId");

-- AddForeignKey
ALTER TABLE "VisionAnalysis" ADD CONSTRAINT "VisionAnalysis_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StylingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
