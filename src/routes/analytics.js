/**
 * Analytics tracking: record brand page views, microstore views, and find/browse visits.
 * POST /api/analytics/track - optional auth; body: { eventType, brandId?, microStoreId? }
 */
import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { optionalAuth } from "../middleware/requireAuth.js";
import { getPrisma } from "../core/db.js";
import { appendHistory } from "../domain/userProfile/userProfile.js";

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

    if (eventType === "find_visit" && userId) {
      await appendHistory(userId, { eventType: "find_visit" });
      const prisma = getPrisma();
      const count = await prisma.userEvent.count({ where: { userId, eventType: "find_visit" } });
      if (count > 0 && count % 5 === 0) {
        import("../agents/userProfileAgent.js").then((m) => m.run({ userId }).catch((err) => console.error("[analytics] need-motivation trigger:", err?.message)));
      }
      return res.json({ success: true });
    }
    if (eventType === "find_visit") {
      return res.json({ success: true });
    }

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
      hint: "Use eventType: 'brand_page_view' with brandId, eventType: 'microstore_view' with microStoreId, or eventType: 'find_visit'",
    });
  })
);

export default router;
