import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { listCartItems } from "../domain/cart/cart.js";
import { runMatchAnalysisForCart } from "../agents/matchAgent.js";

const router = Router();

/** GET /api/cart - list current user's cart (auth required) */
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await listCartItems(req.userId);
    res.json(result);
  })
);

/** GET /api/cart/match - B7.4: cart items with "match to you" analysis (auth required) */
router.get(
  "/match",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [cartResult, matchResult] = await Promise.all([
      listCartItems(req.userId),
      runMatchAnalysisForCart({ userId: req.userId }),
    ]);
    const items = cartResult?.items ?? [];
    const matchByCartId = new Map((matchResult.items ?? []).map((m) => [m.cartItemId, m]));
    const merged = items.map((c) => {
      const m = matchByCartId.get(c.id);
      return {
        ...c,
        matchSummary: m?.matchSummary ?? null,
        matchScore: m?.matchScore ?? null,
      };
    });
    res.json({
      items: merged,
      summary: matchResult.summary ?? null,
    });
  })
);

export default router;
