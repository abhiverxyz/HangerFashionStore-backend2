/**
 * B5.2 Look planning API
 * POST /api/look-planning — plan diverse looks for an occasion (e.g. vacation).
 */
import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { optionalAuth, requireAuth } from "../middleware/requireAuth.js";
import { runLookPlanning } from "../agents/lookPlanningAgent.js";

const router = Router();

/**
 * POST /api/look-planning
 * Body: { occasion (required), numberOfLooks?, vibe?, days?, generateImages?, imageStyle? }
 * Auth: optional. If authenticated, userId is passed for personalization.
 */
router.post(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { occasion, numberOfLooks, vibe, days, generateImages, imageStyle } = req.body || {};
    const occasionStr = (occasion || "").trim();
    if (!occasionStr) {
      return res.status(400).json({ error: "occasion is required" });
    }
    const result = await runLookPlanning({
      occasion: occasionStr,
      numberOfLooks: numberOfLooks != null ? Number(numberOfLooks) : undefined,
      vibe: vibe != null ? String(vibe).trim() : undefined,
      days: days != null ? Number(days) : undefined,
      userId: req.userId ?? undefined,
      generateImages: Boolean(generateImages),
      imageStyle: imageStyle === "on_model" ? "on_model" : "flat_lay",
    });
    res.json(result);
  })
);

export default router;
