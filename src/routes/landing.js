/**
 * Landing page API (B5.4) — uses Personalization Service to choose which page/section to show.
 */
import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { optionalAuth } from "../middleware/requireAuth.js";
import { getLandingPageChoice } from "../domain/personalization/personalization.js";
import { listFeedPosts } from "../domain/contentFeed/contentFeed.js";

const router = Router();

/** GET /api/landing — which landing section to show for the user (optional auth) */
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { total } = await listFeedPosts({
      active: true,
      approvalStatus: "approved",
      limit: 1,
      offset: 0,
    });
    const hasFeedContent = (total ?? 0) > 0;
    const result = await getLandingPageChoice(req.userId ?? null, {
      hasFeedContent,
    });
    res.json(result);
  })
);

export default router;
