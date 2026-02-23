import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  listCartItems,
  addToCart,
  removeFromCart,
  isInCart,
} from "../domain/cart/cart.js";
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

/** POST /api/cart - add item; body: { productId, variantId?, quantity? } (auth required) */
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { productId, variantId, quantity } = req.body || {};
    const item = await addToCart(req.userId, productId, variantId, quantity ?? 1);
    if (!item) return res.status(400).json({ error: "Invalid product or add failed" });
    res.status(201).json(item);
  })
);

/** DELETE /api/cart - remove item; body or query: productId, variantId? (auth required) */
router.delete(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const productId = req.body?.productId ?? req.query?.productId;
    const variantId = req.body?.variantId ?? req.query?.variantId;
    if (!productId) return res.status(400).json({ error: "productId required" });
    const removed = await removeFromCart(req.userId, productId, variantId);
    if (!removed) return res.status(404).json({ error: "Cart item not found" });
    res.status(204).send();
  })
);

/** GET /api/cart/contains?productId=&variantId= - check if in cart (auth required) */
router.get(
  "/contains",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { productId, variantId } = req.query;
    const inCart = await isInCart(req.userId, productId, variantId);
    res.json({ inCart });
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
