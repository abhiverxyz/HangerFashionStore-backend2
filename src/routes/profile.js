import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import * as userProfile from "../domain/userProfile/userProfile.js";
import { run as runUserProfileAgent } from "../agents/userProfileAgent.js";
import { run as runPersonalInsightAgent, shouldRefreshInsight } from "../agents/personalInsightAgent.js";
import { triggerBuildPreferenceGraph } from "../domain/preferences/preferenceGraph.js";

const router = Router();

/** POST /api/profile/generate-need-motivation — run User Profile Agent to generate need & motivation; auth required */
router.post(
  "/generate-need-motivation",
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const result = await runUserProfileAgent({ userId: req.userId });
      triggerBuildPreferenceGraph(req.userId);
      res.json(result);
    } catch (err) {
      console.error("[profile] generate-need-motivation error:", err?.message);
      res.status(500).json({ error: err?.message ?? "Failed to generate need and motivation" });
    }
  })
);

/** Throttle: skip running User Profile Agent if need/motivation were both updated within this many ms */
const NEED_MOTIVATION_THROTTLE_MS = 60 * 60 * 1000; // 1 hour

/** GET /api/profile — return combined user profile (style, history, need/motivation, quiz). Runs User Profile Agent first to refresh need/motivation (throttled to ~1h). */
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    let profile = await userProfile.getUserProfile(req.userId);
    if (!profile) return res.status(404).json({ error: "Profile not found" });

    const needUpdated = profile.fashionNeed?.updatedAt ? new Date(profile.fashionNeed.updatedAt).getTime() : 0;
    const motivationUpdated = profile.fashionMotivation?.updatedAt ? new Date(profile.fashionMotivation.updatedAt).getTime() : 0;
    const now = Date.now();
    const skipAgent =
      needUpdated > 0 &&
      motivationUpdated > 0 &&
      now - needUpdated < NEED_MOTIVATION_THROTTLE_MS &&
      now - motivationUpdated < NEED_MOTIVATION_THROTTLE_MS;

    if (!skipAgent) {
      try {
        await runUserProfileAgent({ userId: req.userId });
      } catch (err) {
        console.error("[profile] GET / refresh need-motivation error:", err?.message);
        // still return profile below (with existing or empty need/motivation)
      }
      profile = await userProfile.getUserProfile(req.userId);
      if (!profile) return res.status(404).json({ error: "Profile not found" });
    }

    if (shouldRefreshInsight(profile)) {
      try {
        await runPersonalInsightAgent({ userId: req.userId });
        profile = await userProfile.getUserProfile(req.userId);
        if (!profile) return res.status(404).json({ error: "Profile not found" });
      } catch (err) {
        console.error("[profile] GET / personal insight error:", err?.message);
        // return profile with existing or null personalInsight
      }
    }

    res.json(profile);
  })
);

/** POST /api/profile/quiz — submit quiz responses. Body: { responses, version? } */
router.post(
  "/quiz",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { responses, version } = req.body ?? {};
    if (responses === undefined) {
      return res.status(400).json({ error: "responses required" });
    }
    await userProfile.submitQuiz(req.userId, { responses, version });
    triggerBuildPreferenceGraph(req.userId);
    const profile = await userProfile.getUserProfile(req.userId);
    res.status(200).json(profile);
  })
);

export default router;
