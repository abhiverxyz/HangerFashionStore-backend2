import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { optionalAuth, requireAuth } from "../middleware/requireAuth.js";
import {
  listBrands,
  getBrand,
  followBrand,
  unfollowBrand,
  isFollowingBrand,
} from "../domain/brand/brand.js";
import { scoreAndOrderBrands } from "../domain/personalization/personalization.js";

const router = Router();

/** GET /api/brands - list; optional auth for following flag. Query: limit, offset, search */
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { limit, offset, search } = req.query;
    const result = await listBrands({ limit, offset, search });
    let orderedItems = result.items;
    if (req.userId && orderedItems.length > 0) {
      const { ordered } = await scoreAndOrderBrands(req.userId, orderedItems, {
        listingType: "brands",
      });
      orderedItems = ordered;
    }
    const items = await Promise.all(
      orderedItems.map(async (b) => {
        const following = req.userId ? await isFollowingBrand(b.id, req.userId) : false;
        return {
          ...b,
          followerCount: b._count?.followers ?? 0,
          productCount: b._count?.products ?? 0,
          following,
        };
      })
    );
    res.json({ items, total: result.total });
  })
);

/** GET /api/brands/:id - get one; optional auth for following */
router.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const brand = await getBrand(req.params.id);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const following = req.userId ? await isFollowingBrand(brand.id, req.userId) : false;
    res.json({
      ...brand,
      followerCount: brand._count?.followers ?? 0,
      productCount: brand._count?.products ?? 0,
      following,
    });
  })
);

/** POST /api/brands/:id/follow - follow brand (auth required) */
router.post(
  "/:id/follow",
  requireAuth,
  asyncHandler(async (req, res) => {
    const brand = await followBrand(req.params.id, req.userId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    res.json({
      followed: true,
      brand: { id: brand.id, followerCount: brand._count?.followers ?? 0 },
    });
  })
);

/** DELETE /api/brands/:id/follow - unfollow brand (auth required) */
router.delete(
  "/:id/follow",
  requireAuth,
  asyncHandler(async (req, res) => {
    const brand = await unfollowBrand(req.params.id, req.userId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    res.json({
      followed: false,
      brand: { id: brand.id, followerCount: brand._count?.followers ?? 0 },
    });
  })
);

export default router;
