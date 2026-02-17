import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAuth, optionalAuth } from "../middleware/requireAuth.js";
import * as lookDomain from "../domain/looks/look.js";
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

    const result = await runLookAnalysisAgent({
      userId: req.userId,
      imageUrl: imageUrl || undefined,
      imageBuffer: file?.buffer,
      contentType: file?.mimetype,
      lookId: lookId || undefined,
    });
    if (req.userId) {
      runStyleReportAgent({ userId: req.userId }).catch((err) =>
        console.warn("[looks] style report trigger failed:", err?.message)
      );
    }
    res.status(200).json(result);
  })
);

/** GET /api/looks - list; if authenticated, filter by userId via query ?userId= */
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { userId, limit, offset } = req.query;
    const filterUserId = userId || (req.userId ?? null);
    const result = await lookDomain.listLooks({
      userId: filterUserId || undefined,
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
