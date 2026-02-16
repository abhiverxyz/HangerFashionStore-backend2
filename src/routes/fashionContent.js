import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import * as fashionContent from "../domain/fashionContent/fashionContent.js";

const router = Router();

/** GET /api/fashion-content/trends — list/search trends (query: limit, offset, category, status, search) */
router.get(
  "/trends",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { limit, offset, category, status, search } = req.query;
    const result = await fashionContent.listTrends({
      limit,
      offset,
      category: category || undefined,
      status: status || undefined,
      search: search || undefined,
    });
    res.json(result);
  })
);

/** GET /api/fashion-content/trends/:id */
router.get(
  "/trends/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const trend = await fashionContent.getTrend(req.params.id);
    if (!trend) return res.status(404).json({ error: "Trend not found" });
    res.json(trend);
  })
);

/** GET /api/fashion-content/styling-rules — list (query: limit, offset, category, status, ruleType, search) */
router.get(
  "/styling-rules",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { limit, offset, category, status, ruleType, search } = req.query;
    const result = await fashionContent.listStylingRules({
      limit,
      offset,
      category: category || undefined,
      status: status || undefined,
      ruleType: ruleType || undefined,
      search: search || undefined,
    });
    res.json(result);
  })
);

/** GET /api/fashion-content/styling-rules/:id */
router.get(
  "/styling-rules/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const rule = await fashionContent.getStylingRule(req.params.id);
    if (!rule) return res.status(404).json({ error: "Styling rule not found" });
    res.json(rule);
  })
);

export default router;
