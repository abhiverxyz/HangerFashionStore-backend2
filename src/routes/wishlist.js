import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  listWishlist,
  addToWishlist,
  removeFromWishlist,
  isInWishlist,
} from "../domain/preferences/preferences.js";
import { runMatchAnalysis } from "../agents/matchAgent.js";

const router = Router();

/** GET /api/wishlist - list current user's wishlist (auth required) */
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await listWishlist(req.userId);
    res.json(result);
  })
);

/** POST /api/wishlist - add item; body: { productId, variantId? } (auth required) */
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { productId, variantId } = req.body || {};
    const item = await addToWishlist(req.userId, productId, variantId);
    if (!item) return res.status(400).json({ error: "Invalid product or add failed" });
    res.status(201).json(item);
  })
);

/** DELETE /api/wishlist - remove item; body or query: productId, variantId? (auth required) */
router.delete(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const productId = req.body?.productId ?? req.query?.productId;
    const variantId = req.body?.variantId ?? req.query?.variantId;
    if (!productId) return res.status(400).json({ error: "productId required" });
    const removed = await removeFromWishlist(req.userId, productId, variantId);
    if (!removed) return res.status(404).json({ error: "Wishlist item not found" });
    res.status(204).send();
  })
);

/** GET /api/wishlist/contains?productId=&variantId= - check if in wishlist (auth required) */
router.get(
  "/contains",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { productId, variantId } = req.query;
    const inWishlist = await isInWishlist(req.userId, productId, variantId);
    res.json({ inWishlist });
  })
);

/** GET /api/wishlist/match - B7.4 Match Agent: wishlist items with "match to you" analysis (auth required) */
router.get(
  "/match",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [wishlistResult, matchResult] = await Promise.all([
      listWishlist(req.userId),
      runMatchAnalysis({ userId: req.userId }),
    ]);
    const items = wishlistResult?.items ?? [];
    const matchByWishlistId = new Map((matchResult.items ?? []).map((m) => [m.wishlistItemId, m]));
    const merged = items.map((w) => {
      const m = matchByWishlistId.get(w.id);
      return {
        ...w,
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
