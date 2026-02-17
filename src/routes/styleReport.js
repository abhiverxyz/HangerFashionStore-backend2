import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { run as runStyleReportAgent } from "../agents/styleReportAgent.js";
import * as userProfile from "../domain/userProfile/userProfile.js";

const router = Router();

/** POST /api/style-report — generate style report from last 10-15 looks; auth required. Returns reportData + styleProfileUpdated. */
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const forceRegenerate = req.body?.forceRegenerate !== false;
    const result = await runStyleReportAgent({ userId: req.userId, forceRegenerate });
    if (result.notEnoughLooks) {
      return res.status(200).json({
        reportData: null,
        styleProfileUpdated: false,
        message: result.message,
      });
    }
    res.json({
      reportData: result.reportData,
      styleProfileUpdated: result.styleProfileUpdated,
    });
  })
);

/** GET /api/style-report — return latest stored style report for rendering; auth required. */
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const latest = await userProfile.getLatestStyleReport(req.userId);
    if (!latest || latest.reportData == null) {
      return res.status(404).json({
        error: "No style report yet. Generate one by calling POST /api/style-report (e.g. after adding looks).",
      });
    }
    res.json({
      reportData: latest.reportData,
      generatedAt: latest.generatedAt,
    });
  })
);

export default router;
