import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { optionalAuth, requireAuth } from "../middleware/requireAuth.js";
import {
  listMicrostores,
  getMicrostore,
  followMicrostore,
  unfollowMicrostore,
  getOrCreateStoreForUser,
  parseSections,
} from "../domain/microstore/microstore.js";
import { scoreAndOrderMicrostores } from "../domain/personalization/personalization.js";

const router = Router();

/** GET /api/microstores - list; optional auth for visibility. Query: brandId, status, featured, limit, offset */
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { brandId, status, featured, limit, offset } = req.query;
    const result = await listMicrostores({
      userId: req.userId ?? null,
      adminBypass: false,
      brandId,
      status,
      featured: featured === "true" || featured === true,
      limit,
      offset,
    });
    let items = result.items.map((s) => ({
      ...s,
      sections: parseSections(s.sections),
      followerCount: s._count?.followers ?? 0,
    }));
    if (req.userId && items.length > 0) {
      const { ordered } = await scoreAndOrderMicrostores(req.userId, items, {
        listingType: "microstores",
      });
      items = ordered;
    }
    res.json({ items, total: result.total });
  })
);

/** GET /api/microstores/store-for-me - get or create "Store for you" for authenticated user */
router.get(
  "/store-for-me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const store = await getOrCreateStoreForUser(req.userId);
    if (!store) return res.status(400).json({ error: "Could not get or create store" });
    const payload = {
      ...store,
      sections: parseSections(store.sections),
      followerCount: store._count?.followers ?? 0,
    };
    res.json(payload);
  })
);

/** POST /api/microstores/store-for-me - alias for get-or-create (POST for refresh) */
router.post(
  "/store-for-me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const store = await getOrCreateStoreForUser(req.userId);
    if (!store) return res.status(400).json({ error: "Could not get or create store" });
    const payload = {
      ...store,
      sections: parseSections(store.sections),
      followerCount: store._count?.followers ?? 0,
    };
    res.json(payload);
  })
);

/** GET /api/microstores/:id - get one; optional auth for visibility */
router.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const store = await getMicrostore(req.params.id, req.userId ?? null, false);
    if (!store) return res.status(404).json({ error: "Microstore not found" });
    const payload = {
      ...store,
      sections: parseSections(store.sections),
      followerCount: store._count?.followers ?? 0,
      styleNotes: typeof store.styleNotes === "string" ? (() => { try { return JSON.parse(store.styleNotes); } catch { return null; } })() : store.styleNotes,
    };
    res.json(payload);
  })
);

/** POST /api/microstores/:id/follow - follow store (auth required) */
router.post(
  "/:id/follow",
  requireAuth,
  asyncHandler(async (req, res) => {
    const store = await followMicrostore(req.params.id, req.userId);
    if (!store) return res.status(404).json({ error: "Microstore not found" });
    res.json({ followed: true, store: { id: store.id, followerCount: store._count?.followers ?? 0 } });
  })
);

/** DELETE /api/microstores/:id/follow - unfollow store (auth required) */
router.delete(
  "/:id/follow",
  requireAuth,
  asyncHandler(async (req, res) => {
    const store = await unfollowMicrostore(req.params.id, req.userId);
    if (!store) return res.status(404).json({ error: "Microstore not found" });
    res.json({ followed: false, store: { id: store.id, followerCount: store._count?.followers ?? 0 } });
  })
);

export default router;
