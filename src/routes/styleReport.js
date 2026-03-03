import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { run as runStyleReportAgent } from "../agents/styleReportAgent.js";
import * as userProfile from "../domain/userProfile/userProfile.js";
import { getStyleReportSettings } from "../config/styleReportSettings.js";
import { listLooksForStyleReport } from "../domain/looks/look.js";
import {
  buildLookFingerprint,
  buildSettingsFingerprint,
  buildStyleReportInputFingerprint,
} from "../utils/styleReportFingerprint.js";
import { styleReportLimiter } from "../middleware/rateLimit.js";

const router = Router();
router.use(styleReportLimiter);

/** In-memory lock per userId to avoid duplicate concurrent style report runs (code review). */
const styleReportLocks = new Map();

/**
 * Compute current input fingerprint for the user (same inputs the agent would use).
 * Used to return cached report when inputs unchanged.
 */
async function computeCurrentFingerprint(userId) {
  const settings = await getStyleReportSettings();
  const { items: looks } = await listLooksForStyleReport(userId, settings.maxLooks);
  const lookFp = buildLookFingerprint(looks);
  const settingsFp = buildSettingsFingerprint(settings);
  return buildStyleReportInputFingerprint(lookFp, settingsFp);
}

/** POST /api/style-report — generate style report from last N looks; auth required. Returns reportData + styleProfileUpdated. When forceRegenerate is false, returns cached report if input fingerprint matches. */
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const forceRegenerate = req.body?.forceRegenerate === true;
    const userId = req.userId;

    if (!forceRegenerate) {
      const currentFp = await computeCurrentFingerprint(userId);
      const latest = await userProfile.getLatestStyleReport(userId);
      if (
        latest?.reportData != null &&
        latest?.inputFingerprint != null &&
        latest.inputFingerprint === currentFp
      ) {
        return res.json({
          reportData: latest.reportData,
          styleProfileUpdated: false,
          cached: true,
        });
      }
    }

    if (styleReportLocks.get(userId)) {
      return res.status(409).json({
        error: "Style report is already being generated. Try again in a moment.",
        code: "generation_in_progress",
      });
    }
    styleReportLocks.set(userId, true);
    let result;
    try {
      result = await runStyleReportAgent({ userId, forceRegenerate });
    } finally {
      styleReportLocks.delete(userId);
    }
    if (result.notEnoughLooks) {
      return res.status(200).json({
        reportData: null,
        styleProfileUpdated: false,
        message: result.message,
        code: "not_enough_looks",
      });
    }
    return res.json({
      reportData: result.reportData,
      styleProfileUpdated: result.styleProfileUpdated,
    });
  })
);

/** GET /api/style-report — return latest stored style report only if input fingerprint still matches (so we do not show stale report after looks/settings change). Auth required. */
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId;
    const latest = await userProfile.getLatestStyleReport(userId);
    if (!latest || latest.reportData == null) {
      return res.status(404).json({
        error: "No style report yet. Generate one by calling POST /api/style-report (e.g. after adding looks).",
        code: "no_report",
      });
    }
    const currentFp = await computeCurrentFingerprint(userId);
    if (latest.inputFingerprint != null && latest.inputFingerprint !== currentFp) {
      return res.status(404).json({
        error: "Style report is out of date (looks or settings changed). Call POST /api/style-report to regenerate.",
        code: "report_stale",
      });
    }
    res.json({
      reportData: latest.reportData,
      generatedAt: latest.generatedAt,
    });
  })
);

export default router;
