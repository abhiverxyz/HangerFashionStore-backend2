/**
 * Analytics tracking: record brand page views and microstore views.
 * POST /api/analytics/track - optional auth; body: { eventType, brandId?, microStoreId? }
 */
import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { optionalAuth } from "../middleware/requireAuth.js";
import { getPrisma } from "../core/db.js";

const router = Router();

router.post(
  "/track",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { eventType, brandId, microStoreId } = req.body || {};
    const userId = req.userId ?? null;
    const ipAddress = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.headers["x-real-ip"] || null;
    const userAgent = req.headers["user-agent"] || null;
    const referrer = req.headers["referer"] || req.headers["referrer"] || null;

    if (eventType === "brand_page_view" && brandId) {
      const prisma = getPrisma();
      await prisma.brandPageView.create({
        data: {
          brandId: String(brandId).trim(),
          userId,
          ipAddress,
          userAgent,
          referrer,
        },
      });
      return res.json({ success: true });
    }

    if (eventType === "microstore_view" && microStoreId) {
      const prisma = getPrisma();
      await prisma.microStoreView.create({
        data: {
          microStoreId: String(microStoreId).trim(),
          userId,
          ipAddress,
          userAgent,
          referrer,
        },
      });
      return res.json({ success: true });
    }

    return res.status(400).json({
      error: "Invalid event type or missing required fields",
      hint: "Use eventType: 'brand_page_view' with brandId, or eventType: 'microstore_view' with microStoreId",
    });
  })
);

export default router;
