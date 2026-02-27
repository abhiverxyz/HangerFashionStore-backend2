import { Router } from "express";
import { randomUUID } from "crypto";
import multer from "multer";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import * as lookDomain from "../domain/looks/look.js";
import { uploadFile } from "../utils/storage.js";
import { run as runLookAnalysisAgent } from "../agents/lookAnalysisAgent.js";
import { run as runStyleReportAgent } from "../agents/styleReportAgent.js";

const router = Router();
const IMAGE_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
const uploadAnalyze = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype && IMAGE_MIMES.includes(file.mimetype.toLowerCase());
    cb(null, !!ok);
  },
});

/** POST /api/looks/analyze - analyze look image (fashion diary); persist look. Body: imageUrl?, lookId?; or multipart file. Auth required. */
router.post(
  "/analyze",
  requireAuth,
  uploadAnalyze.single("file"),
  asyncHandler(async (req, res) => {
    const imageUrl = req.body?.imageUrl != null ? String(req.body.imageUrl).trim() : null;
    const lookId = req.body?.lookId != null ? String(req.body.lookId).trim() : null;
    const file = req.file;

    if (!imageUrl && !lookId && (!file || !file.buffer)) {
      return res.status(400).json({
        error: "Provide imageUrl (URL), lookId (to re-analyze), or upload a file (multipart field: file)",
      });
    }

    if (lookId) {
      const existing = await lookDomain.getLook(lookId);
      if (!existing) return res.status(404).json({ error: "Look not found" });
      if (existing.userId && existing.userId !== req.userId) {
        return res.status(403).json({ error: "Forbidden: you can only re-analyze your own look" });
      }
    }

    const isNewLookFromFile = file?.buffer && !lookId;

    if (isNewLookFromFile) {
      // Image-first flow: upload, create look immediately, return. Run analysis in background.
      const key = `looks/${req.userId}/${randomUUID()}`;
      const ct = file.mimetype || "image/jpeg";
      const { url } = await uploadFile(file.buffer, key, ct, { requireRemote: false });
      const look = await lookDomain.createLook({
        userId: req.userId,
        imageUrl: url,
        vibe: null,
        occasion: null,
        lookData: JSON.stringify({ status: "analyzing", comment: "Analyzing your look…" }),
      });
      (async () => {
        try {
          const result = await runLookAnalysisAgent({
            userId: req.userId,
            lookId: look.id,
          });
          if (req.userId) {
            runStyleReportAgent({ userId: req.userId }).catch((err) =>
              console.warn("[looks] style report trigger failed:", err?.message)
            );
          }
        } catch (err) {
          console.warn("[looks] background analysis failed:", err?.message);
        }
      })();
      return res.status(201).json({
        comment: "Analyzing your look…",
        vibe: null,
        occasion: null,
        timeOfDay: null,
        labels: [],
        analysisComment: "Analyzing your look…",
        suggestions: [],
        classificationTags: [],
        lookId: look.id,
        look: {
          id: look.id,
          imageUrl: look.imageUrl,
          vibe: look.vibe,
          occasion: look.occasion,
          lookData: look.lookData,
          createdAt: look.createdAt?.toISOString?.() ?? look.createdAt,
          updatedAt: look.updatedAt?.toISOString?.() ?? look.updatedAt,
        },
      });
    }

    const result = await runLookAnalysisAgent({
      userId: req.userId,
      imageUrl: imageUrl || undefined,
      imageBuffer: file?.buffer,
      contentType: file?.mimetype,
      lookId: lookId || undefined,
      fast: false,
    });
    if (req.userId) {
      runStyleReportAgent({ userId: req.userId }).catch((err) =>
        console.warn("[looks] style report trigger failed:", err?.message)
      );
    }
    res.status(200).json(result);
  })
);

/** GET /api/looks - list; requires auth, filters by current user's userId */
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { limit, offset } = req.query;
    const result = await lookDomain.listLooks({
      userId: req.userId,
      limit,
      offset,
    });
    res.json(result);
  })
);

/** GET /api/looks/:id */
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const look = await lookDomain.getLook(req.params.id);
    if (!look) return res.status(404).json({ error: "Look not found" });
    res.json(look);
  })
);

/** POST /api/looks - create (auth required) */
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { lookData, imageUrl, vibe, occasion } = req.body || {};
    const look = await lookDomain.createLook({
      userId: req.userId,
      lookData: lookData ?? "{}",
      imageUrl: imageUrl ?? null,
      vibe: vibe ?? null,
      occasion: occasion ?? null,
    });
    res.status(201).json(look);
  })
);

/** PUT /api/looks/:id - update (auth required; ownership check) */
router.put(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await lookDomain.getLook(req.params.id);
    if (!existing) return res.status(404).json({ error: "Look not found" });
    if (existing.userId && existing.userId !== req.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const look = await lookDomain.updateLook(req.params.id, req.body || {});
    res.json(look);
  })
);

/** DELETE /api/looks/:id - ownership check */
router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await lookDomain.getLook(req.params.id);
    if (!existing) return res.status(404).json({ error: "Look not found" });
    if (existing.userId && existing.userId !== req.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    await lookDomain.deleteLook(req.params.id);
    res.status(204).send();
  })
);

export default router;
