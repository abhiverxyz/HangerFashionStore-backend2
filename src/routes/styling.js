/**
 * Live Styling Session API
 * Mount at: router.use('/styling', stylingRouter) -> /api/styling/session/*
 * All routes require auth (req.userId).
 */

import { Router } from "express";
import multer from "multer";
import { getPrisma } from "../core/db.js";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { getIntroResponse, getAssistantResponse, getSessionSummary } from "../agents/liveStylingSessionAgent.js";
import { analyzeSessionFrames } from "../utils/sessionVisionAnalysis.js";
import { uploadFile } from "../utils/storage.js";
import * as lookDomain from "../domain/looks/look.js";
import { normalizeId } from "../core/helpers.js";
import { randomUUID } from "crypto";

const router = Router();

const IMAGE_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
const uploadFrames = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype && IMAGE_MIMES.includes(file.mimetype.toLowerCase());
    cb(null, !!ok);
  },
});
const uploadSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype && IMAGE_MIMES.includes(file.mimetype.toLowerCase());
    cb(null, !!ok);
  },
});

async function getSessionForUser(sessionId, userId) {
  const prisma = getPrisma();
  const session = await prisma.stylingSession.findUnique({
    where: { id: normalizeId(sessionId) },
    include: { analyses: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!session || session.userId !== normalizeId(userId)) return null;
  return session;
}

/** POST /api/styling/session/start */
router.post(
  "/session/start",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { mode = "live_styling", entryPoint, device } = req.body || {};
    const prisma = getPrisma();
    const session = await prisma.stylingSession.create({
      data: {
        userId: req.userId,
        mode: String(mode),
        entryPoint: entryPoint != null ? String(entryPoint) : null,
        device: device && typeof device === "object" ? device : null,
        currentState: "INTRO",
        stateHistory: [],
        messages: [],
      },
    });
    const intro = await getIntroResponse();
    res.status(201).json({
      sessionId: session.id,
      state: intro.state,
      assistant: intro.assistant,
      ui: intro.ui,
    });
  })
);

/** POST /api/styling/session/:sessionId/analyze - multipart: frames (1-3 images) */
router.post(
  "/session/:sessionId/analyze",
  requireAuth,
  uploadFrames.array("frames", 3),
  asyncHandler(async (req, res) => {
    const session = await getSessionForUser(req.params.sessionId, req.userId);
    if (!session) return res.status(404).json({ error: "Session not found" });

    const files = req.files && Array.isArray(req.files) ? req.files : [];
    const buffers = files.filter((f) => f.buffer).map((f) => f.buffer);
    if (buffers.length === 0) return res.status(400).json({ error: "Send 1-3 images in multipart field 'frames'" });

    const signals = await analyzeSessionFrames(buffers);
    const prisma = getPrisma();
    const analysis = await prisma.visionAnalysis.create({
      data: {
        sessionId: session.id,
        signals,
      },
    });
    await prisma.stylingSession.update({
      where: { id: session.id },
      data: { lastAnalysisId: analysis.id },
    });

    res.json({
      analysisId: analysis.id,
      signals,
    });
  })
);

/** POST /api/styling/session/:sessionId/respond */
router.post(
  "/session/:sessionId/respond",
  requireAuth,
  asyncHandler(async (req, res) => {
    const session = await getSessionForUser(req.params.sessionId, req.userId);
    if (!session) return res.status(404).json({ error: "Session not found" });

    const { userMessage, state, analysisId, clientContext } = req.body || {};
    let visionSignals = null;
    if (analysisId && session.lastAnalysisId === analysisId) {
      const prisma = getPrisma();
      const analysis = await prisma.visionAnalysis.findUnique({
        where: { id: analysisId },
      });
      if (analysis && typeof analysis.signals === "object") visionSignals = analysis.signals;
    }

    const response = await getAssistantResponse(req.userId, session, {
      userMessage: userMessage != null ? String(userMessage) : undefined,
      analysisId: analysisId || undefined,
      visionSignals,
      clientContext: clientContext && typeof clientContext === "object" ? clientContext : undefined,
    });

    const prisma = getPrisma();
    const stateHistory = Array.isArray(session.stateHistory) ? [...session.stateHistory] : [];
    stateHistory.push({ state: response.state, at: new Date().toISOString() });
    const messages = Array.isArray(session.messages) ? [...session.messages] : [];
    if (userMessage != null && String(userMessage).trim()) {
      messages.push({ role: "user", content: String(userMessage).trim() });
    }
    messages.push({ role: "assistant", content: response.assistant.text });

    await prisma.stylingSession.update({
      where: { id: session.id },
      data: {
        currentState: response.state,
        stateHistory,
        messages,
      },
    });

    res.json({
      state: response.state,
      assistant: response.assistant,
      ui: response.ui,
    });
  })
);

/** POST /api/styling/session/:sessionId/save - multipart: finalImage (optional); body: tags, userNotes, or finalImageUrl */
router.post(
  "/session/:sessionId/save",
  requireAuth,
  uploadSingle.single("finalImage"),
  asyncHandler(async (req, res) => {
    const session = await getSessionForUser(req.params.sessionId, req.userId);
    if (!session) return res.status(404).json({ error: "Session not found" });

    let tags = req.body?.tags != null ? req.body.tags : {};
    if (typeof tags === "string") {
      try {
        tags = JSON.parse(tags);
      } catch {
        tags = {};
      }
    }
    if (typeof tags !== "object" || tags === null) tags = {};
    const userNotes = req.body?.userNotes != null ? String(req.body.userNotes).trim() : null;
    let finalImageUrl = req.body?.finalImageUrl != null ? String(req.body.finalImageUrl).trim() : null;

    if (req.file && req.file.buffer) {
      const key = `styling/${req.userId}/${randomUUID()}`;
      const ct = req.file.mimetype || "image/jpeg";
      const { url } = await uploadFile(req.file.buffer, key, ct, { requireRemote: false });
      finalImageUrl = url;
    }

    const vibe = Array.isArray(tags.vibe) && tags.vibe.length > 0 ? tags.vibe[0] : null;
    const occasion = Array.isArray(tags.occasion) && tags.occasion.length > 0 ? tags.occasion[0] : null;
    const timeTag = Array.isArray(tags.time) && tags.time.length > 0 ? tags.time[0] : null;

    let visionSignals = null;
    if (session.lastAnalysisId) {
      const prisma = getPrisma();
      const analysis = await prisma.visionAnalysis.findUnique({
        where: { id: session.lastAnalysisId },
      });
      if (analysis && typeof analysis.signals === "object") visionSignals = analysis.signals;
    }

    const summary = await getSessionSummary(req.userId, session, visionSignals);
    const lookData = JSON.stringify({
      comment: summary.title,
      sessionSummary: { whatWorks: summary.whatWorks, nextTime: summary.nextTime },
      timeOfDay: timeTag,
      source: "live_styling_session",
    });

    const look = await lookDomain.createLook({
      userId: req.userId,
      lookData,
      imageUrl: finalImageUrl,
      vibe,
      occasion,
    });

    const prisma = getPrisma();
    await prisma.stylingSession.update({
      where: { id: session.id },
      data: {
        outputs: { lookId: look.id, summary, savedAt: new Date().toISOString() },
      },
    });

    res.json({
      lookId: look.id,
      diarySaved: true,
      summary: {
        title: summary.title,
        whatWorks: summary.whatWorks,
        nextTime: summary.nextTime,
      },
    });
  })
);

export default router;
