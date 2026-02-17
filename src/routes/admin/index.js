/**
 * Admin router: import (admin-or-secret), then requireAdmin, then mounted sub-routers.
 */
import { Router } from "express";
import { requireAdmin } from "../../middleware/requireAdmin.js";
import { requireAdminOrSecret } from "../../middleware/requireAdminOrSecret.js";
import { asyncHandler } from "../../core/asyncHandler.js";
import { importBrandFromPublicUrl, importBrandFromPublicPayload } from "../../domain/product/importPublic.js";

import brandsRouter from "./brands.js";
import modelConfigRouter from "./modelConfig.js";
import contentRouter from "./content.js";
import microstoresRouter from "./microstores.js";
import feedRouter from "./feed.js";
import storageTestRouter from "./storageTest.js";

const router = Router();

// Import endpoints: allow ADMIN_SECRET so CLI can auth without JWT
router.post(
  "/import-public",
  requireAdminOrSecret,
  asyncHandler(async (req, res) => {
    const { url, brandName } = req.body || {};
    const urlInput = (url || "").trim();
    if (!urlInput) {
      return res.status(400).json({ error: "url is required" });
    }
    console.log("[admin] import-public request:", { url: urlInput, brandName: brandName || "(derive from URL)" });
    const result = await importBrandFromPublicUrl(urlInput, brandName?.trim() || undefined);
    console.log("[admin] import-public done:", result.summary);
    res.status(201).json({
      success: true,
      message: "Import completed; products enqueued for enrichment",
      summary: result.summary,
      brand: result.brand,
    });
  })
);

router.post(
  "/import-public-payload",
  requireAdminOrSecret,
  asyncHandler(async (req, res) => {
    const { url, brandName, products } = req.body || {};
    const urlInput = (url || "").trim();
    if (!urlInput) {
      return res.status(400).json({ error: "url is required" });
    }
    if (!Array.isArray(products)) {
      return res.status(400).json({ error: "products array is required" });
    }
    console.log("[admin] import-public-payload request:", { url: urlInput, productCount: products.length });
    const result = await importBrandFromPublicPayload(urlInput, brandName?.trim() || undefined, products);
    console.log("[admin] import-public-payload done:", result.summary);
    res.status(201).json({
      success: true,
      message: "Import completed; products enqueued for enrichment",
      summary: result.summary,
      brand: result.brand,
    });
  })
);

router.use(requireAdmin);

router.use(brandsRouter);
router.use(modelConfigRouter);
router.use(contentRouter);
router.use(microstoresRouter);
router.use(feedRouter);
router.use(storageTestRouter);

export default router;
