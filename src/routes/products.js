import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { getProduct, listProducts } from "../domain/product/product.js";

const router = Router();

/** GET /api/products - list with ?brandId=&status=&limit=&offset= */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { brandId, status, limit, offset } = req.query;
    const result = await listProducts({ brandId, status, limit, offset });
    res.json(result);
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
