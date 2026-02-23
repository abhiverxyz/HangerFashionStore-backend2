import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { optionalAuth } from "../middleware/requireAuth.js";
import { getProduct, listProducts } from "../domain/product/product.js";
import { scoreAndOrderProducts, scoreAndOrderProductsWithGraph, orderByDiversityOnly } from "../domain/personalization/personalization.js";
import { getPreferenceGraph, triggerBuildPreferenceGraph } from "../domain/preferences/preferenceGraph.js";

const router = Router();

/** GET /api/products - list with ?brandId=&status=&limit=&offset=&personalized=; optional auth. When personalized=1 and auth, use graph if present else full scoring; else diversity-only (C+ Phase 1 & 3). */
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const { brandId, status, limit, offset, search, personalized } = req.query;
    const result = await listProducts({ brandId, status, limit, offset, search });
    let items = result.items;
    if (items.length > 0) {
      const usePersonalized = personalized === "1" || personalized === true;
      if (usePersonalized && req.userId) {
        const graph = await getPreferenceGraph(req.userId);
        if (graph) {
          const { ordered } = scoreAndOrderProductsWithGraph(items, graph, {
            listingType: "products",
            search: search ?? undefined,
          });
          items = ordered;
          res.setHeader("X-List-Order", "graph");
        } else {
          triggerBuildPreferenceGraph(req.userId);
          const { ordered } = await scoreAndOrderProducts(req.userId, items, {
            listingType: "products",
            search: search ?? undefined,
          });
          items = ordered;
          res.setHeader("X-List-Order", "scored");
        }
      } else {
        items = orderByDiversityOnly(items);
        res.setHeader("X-List-Order", "diversity");
      }
    }
    const itemsWithPrice = items.map((p) => ({
      ...p,
      price: p.variants?.[0]?.price != null ? `₹${p.variants[0].price}` : null,
    }));
    res.json({ items: itemsWithPrice, total: result.total });
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
