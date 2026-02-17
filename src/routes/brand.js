/**
 * Brand user dashboard: brand zone (own brand) and microstores scoped to brand's products.
 * All routes require requireBrand (admin or brand). Brand users can only access their own brandId.
 */
import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireBrand } from "../middleware/requireBrand.js";
import { getPrisma } from "../core/db.js";
import * as brandDomain from "../domain/brand/brand.js";
import * as microstore from "../domain/microstore/microstore.js";
import * as contentFeed from "../domain/contentFeed/contentFeed.js";

const router = Router();
router.use(requireBrand);

/** GET /api/brand/me - get current user's brand (brand users only; admin gets 400 if no brandId in query) */
router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const brandId = req.brandId || req.query.brandId;
    if (!brandId) return res.status(400).json({ error: "Brand context required" });
    const brand = await brandDomain.getBrand(brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    if (req.user.role === "brand" && brandId !== req.brandId) return res.status(403).json({ error: "Access denied" });
    res.json({
      ...brand,
      followerCount: brand._count?.followers ?? 0,
      productCount: brand._count?.products ?? 0,
    });
  })
);

/** PUT /api/brand/me - update current user's brand (brand zone); brand users can only update their own */
router.put(
  "/me",
  asyncHandler(async (req, res) => {
    const brandId = req.brandId || req.body?.brandId;
    if (!brandId) return res.status(400).json({ error: "Brand context required" });
    if (req.user.role === "brand" && brandId !== req.brandId) return res.status(403).json({ error: "Access denied" });
    const { brandId: _b, ...data } = req.body || {};
    const updated = await brandDomain.updateBrand(brandId, data);
    if (!updated) return res.status(404).json({ error: "Brand not found" });
    res.json(updated);
  })
);

/** GET /api/brand/microstores - list microstores for current brand (brand users see only their brand's) */
router.get(
  "/microstores",
  asyncHandler(async (req, res) => {
    const brandId = req.brandId || req.query.brandId;
    if (!brandId) return res.status(400).json({ error: "Brand context required" });
    if (req.user.role === "brand" && brandId !== req.brandId) return res.status(403).json({ error: "Access denied" });
    const result = await microstore.listMicrostores({
      userId: null,
      adminBypass: true,
      brandId,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    });
    const items = result.items.map((s) => ({
      ...s,
      sections: microstore.parseSections(s.sections),
      followerCount: s._count?.followers ?? 0,
    }));
    res.json({ items, total: result.total });
  })
);

/** POST /api/brand/microstores - create microstore; brand users: brandId forced to their brand */
router.post(
  "/microstores",
  asyncHandler(async (req, res) => {
    const body = { ...(req.body || {}) };
    if (req.brandId) body.brandId = req.brandId;
    const created = await microstore.createMicrostore(body);
    res.status(201).json(created);
  })
);

/** POST /api/brand/microstores/:id/submit-for-approval - submit microstore for admin approval (brand users only) */
router.post(
  "/microstores/:id/submit-for-approval",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const store = await microstore.getMicrostore(id, null, true);
    if (!store) return res.status(404).json({ error: "Microstore not found" });
    if (req.brandId && store.brandId !== req.brandId) return res.status(403).json({ error: "Access denied" });
    try {
      const updated = await microstore.submitMicrostoreForApproval(id);
      res.json(updated);
    } catch (err) {
      if (err.message?.includes("must be in draft")) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  })
);

/** PUT /api/brand/microstores/:id/products - set products; brand users: only products from their brand */
router.put(
  "/microstores/:id/products",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const store = await microstore.getMicrostore(id, null, true);
    if (!store) return res.status(404).json({ error: "Microstore not found" });
    if (req.brandId && store.brandId !== req.brandId) return res.status(403).json({ error: "Access denied" });
    const scopeBrandId = req.brandId || store.brandId || null;
    const { sections } = req.body || {};
    const updated = await microstore.setMicroStoreProducts(id, sections || [], scopeBrandId);
    res.json(updated);
  })
);

/** GET /api/brand/feed-posts - list feed posts for current brand */
router.get(
  "/feed-posts",
  asyncHandler(async (req, res) => {
    const brandId = req.brandId || req.query.brandId;
    if (!brandId) return res.status(400).json({ error: "Brand context required" });
    if (req.user.role === "brand" && brandId !== req.brandId) return res.status(403).json({ error: "Access denied" });
    const result = await contentFeed.listFeedPosts({
      brandId,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    });
    res.json({ posts: result.items, total: result.total });
  })
);

/** POST /api/brand/feed-posts - brand create (draft, pending approval) */
router.post(
  "/feed-posts",
  asyncHandler(async (req, res) => {
    const brandId = req.brandId;
    if (!brandId) return res.status(400).json({ error: "Brand context required" });
    const body = { ...(req.body || {}) };
    const post = await contentFeed.createFeedPost({
      ...body,
      createdBy: "brand",
      createdByUserId: req.userId ?? null,
      brandId,
      approvalStatus: "pending",
    });
    res.status(201).json({ post });
  })
);

/** GET /api/brand/analytics - analytics for brand (views, followers, per-microstore breakdown) */
router.get(
  "/analytics",
  asyncHandler(async (req, res) => {
    const brandId = req.brandId || req.query.brandId;
    if (!brandId) return res.status(400).json({ error: "Brand context required" });
    if (req.user.role === "brand" && brandId !== req.brandId) return res.status(403).json({ error: "Access denied" });
    const prisma = getPrisma();

    const microStores = await prisma.microStore.findMany({
      where: { brandId, deletedAt: null },
      select: { id: true, name: true },
    });
    const microStoreIds = microStores.map((s) => s.id);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      brandPageViews,
      microStoreViews,
      brandFollowers,
      microStoreFollowers,
      recentBrandPageViews,
      recentMicroStoreViews,
    ] = await Promise.all([
      prisma.brandPageView.count({ where: { brandId } }),
      microStoreIds.length
        ? prisma.microStoreView.count({ where: { microStoreId: { in: microStoreIds } } })
        : 0,
      prisma.brandFollower.count({ where: { brandId } }),
      microStoreIds.length
        ? prisma.microStoreFollower.count({ where: { microStoreId: { in: microStoreIds } } })
        : 0,
      prisma.brandPageView.count({
        where: { brandId, viewedAt: { gte: thirtyDaysAgo } },
      }),
      microStoreIds.length
        ? prisma.microStoreView.count({
            where: { microStoreId: { in: microStoreIds }, viewedAt: { gte: thirtyDaysAgo } },
          })
        : 0,
    ]);

    let microStoreViewCounts = [];
    if (microStoreIds.length > 0) {
      const counts = await prisma.microStoreView.groupBy({
        by: ["microStoreId"],
        where: { microStoreId: { in: microStoreIds } },
        _count: { microStoreId: true },
      });
      const countByStore = Object.fromEntries(
        counts.map((c) => [c.microStoreId, c._count.microStoreId])
      );
      microStoreViewCounts = microStores.map((store) => ({
        storeId: store.id,
        name: store.name,
        views: countByStore[store.id] ?? 0,
      }));
    }

    const followers = brandFollowers + microStoreFollowers;

    const productCount = await prisma.product.count({ where: { brandId, status: "active" } });

    res.json({
      brandPageViews,
      microStoreViews,
      followers,
      recentBrandPageViews,
      recentMicroStoreViews,
      microStoreViewCounts,
      products: productCount,
      microstores: microStores.length,
    });
  })
);

export default router;
