import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { optionalAuth } from "../middleware/requireAuth.js";
import { getProduct, listProducts } from "../domain/product/product.js";
import { scoreAndOrderProducts } from "../domain/personalization/personalization.js";

const router = Router();

/** GET /api/products - list with ?brandId=&status=&limit=&offset=; optional auth for personalization order */
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { brandId, status, limit, offset, search } = req.query;
    const result = await listProducts({ brandId, status, limit, offset, search });
    let items = result.items;
    if (req.userId && items.length > 0) {
      const { ordered } = await scoreAndOrderProducts(req.userId, items, {
        listingType: "products",
        search: search ?? undefined,
      });
      items = ordered;
    }
    res.json({ items, total: result.total });
  })
);

/** GET /api/products/:id */
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const product = await getProduct(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json(product);
  })
);

export default router;
