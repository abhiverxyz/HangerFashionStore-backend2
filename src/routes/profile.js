import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import * as userProfile from "../domain/userProfile/userProfile.js";
import { run as runUserProfileAgent } from "../agents/userProfileAgent.js";

const router = Router();

/** POST /api/profile/generate-need-motivation — run User Profile Agent to generate need & motivation; auth required */
router.post(
  "/generate-need-motivation",
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const result = await runUserProfileAgent({ userId: req.userId });
      res.json(result);
    } catch (err) {
      console.error("[profile] generate-need-motivation error:", err?.message);
      res.status(500).json({ error: err?.message ?? "Failed to generate need and motivation" });
    }
  })
);

/** GET /api/profile — return combined user profile (style, history, need/motivation, quiz) */
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const profile = await userProfile.getUserProfile(req.userId);
    if (!profile) return res.status(404).json({ error: "Profile not found" });
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
    const profile = await userProfile.getUserProfile(req.userId);
    res.status(200).json(profile);
  })
);

export default router;
