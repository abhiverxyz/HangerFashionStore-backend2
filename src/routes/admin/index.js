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
import allowedMicrostoreCreatorsRouter from "./allowedMicrostoreCreators.js";
import storeForYouConstructRouter from "./storeForYouConstruct.js";
import feedRouter from "./feed.js";
import storageTestRouter from "./storageTest.js";
import agentPromptsRouter from "./agentPrompts.js";
import { getStyleReportSettings, saveStyleReportSettings } from "../../config/styleReportSettings.js";

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

/** GET /style-report-settings — for admin style report page */
router.get(
  "/style-report-settings",
  asyncHandler(async (_req, res) => {
    const settings = await getStyleReportSettings();
    res.json(settings);
  })
);

/** PUT /style-report-settings — update min/max looks, objective, tone, card config, style identity options */
router.put(
  "/style-report-settings",
  asyncHandler(async (req, res) => {
    const updated = await saveStyleReportSettings(req.body || {});
    res.json(updated);
  })
);

router.use(brandsRouter);
router.use(modelConfigRouter);
router.use(contentRouter);
router.use(microstoresRouter);
router.use(allowedMicrostoreCreatorsRouter);
router.use(storeForYouConstructRouter);
router.use(feedRouter);
router.use(storageTestRouter);
router.use(agentPromptsRouter);

export default router;
