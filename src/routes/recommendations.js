import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { runMatchRecommendations } from "../agents/matchAgent.js";

const router = Router();

/** GET /api/recommendations/match-for-you - products outside wishlist/cart that match the user (auth required). Query: limit? (default 12) */
router.get(
  "/match-for-you",
  requireAuth,
  asyncHandler(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const result = await runMatchRecommendations({ userId: req.userId, limit });
    res.json({
      items: result.items,
      summary: result.summary,
    });
  })
);

export default router;
