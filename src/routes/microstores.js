import { Router } from "express";
import { randomUUID } from "crypto";
import multer from "multer";
import { asyncHandler } from "../core/asyncHandler.js";
import { optionalAuth, requireAuth } from "../middleware/requireAuth.js";
import {
  listMicrostores,
  getMicrostore,
  createMicrostore,
  updateMicrostore,
  followMicrostore,
  unfollowMicrostore,
  getOrCreateStoreForUser,
  refreshStoreForUser,
  parseSections,
  submitMicrostoreForApproval,
  isPersonalStore,
  getPersonalStoreOwnerId,
} from "../domain/microstore/microstore.js";
import { triggerBuildPreferenceGraph } from "../domain/preferences/preferenceGraph.js";
import { scoreAndOrderMicrostores } from "../domain/personalization/personalization.js";
import * as allowedMicrostoreCreators from "../domain/allowedMicrostoreCreators/allowedMicrostoreCreators.js";
import { suggestMicrostoreName, suggestOneStyleNote, generateMicrostoreCoverImage, suggestProductsForMicrostore } from "../agents/microstoreCurationAgent.js";
import { urlToStorageKey, uploadFile } from "../utils/storage.js";

const IMAGE_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype && IMAGE_MIMES.includes(file.mimetype.toLowerCase());
    cb(null, !!ok);
  },
});

/** Extract storage key from URL path or bare key (e.g. .../generated/uuid.webp or generated/uuid.webp) when urlToStorageKey fails. */
function fallbackKeyFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  const u = url.trim();
  const pathPart = u.replace(/#.*$/, "").split("?")[0] || u;
  const generatedMatch = pathPart.match(/\/generated\/([a-zA-Z0-9_.-]+\.webp)/i) || pathPart.match(/\/generated\/([a-zA-Z0-9_.-]+)$/i);
  if (generatedMatch && !generatedMatch[1].includes("..")) return "generated/" + generatedMatch[1];
  if (u.startsWith("generated/") && !u.includes("..")) return u.split("?")[0] || u;
  if (u.includes("/uploads/")) {
    const after = u.split("/uploads/")[1];
    if (after && !after.includes("..")) return after.split("?")[0] || null;
  }
  if (u.startsWith("uploads/") && !u.includes("..")) return u.split("?")[0] || u;
  return null;
}

/** Resolve coverImageUrl to a URL the client can load (storage access proxy for R2 or /uploads). */
function resolveCoverImageUrlForClient(coverImageUrl) {
  if (!coverImageUrl || typeof coverImageUrl !== "string") return coverImageUrl;
  let key = urlToStorageKey(coverImageUrl.trim());
  if (!key) key = fallbackKeyFromUrl(coverImageUrl);
  if (key) return `/api/storage/access?key=${encodeURIComponent(key)}`;
  return coverImageUrl;
}

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
      coverImageUrl: resolveCoverImageUrlForClient(s.coverImageUrl) ?? s.coverImageUrl,
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

function parseIdeasForYou(ideasForYouJson) {
  if (!ideasForYouJson || typeof ideasForYouJson !== "string") return [];
  try {
    const arr = JSON.parse(ideasForYouJson);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** GET /api/microstores/store-for-me - get or create "Store for you" for authenticated user */
router.get(
  "/store-for-me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const store = await getOrCreateStoreForUser(req.userId);
    if (!store) return res.status(400).json({ error: "Could not get or create store" });
    const { getStoreForYouConstruct } = await import("../domain/storeForYouConstruct/storeForYouConstruct.js");
    const construct = await getStoreForYouConstruct();
    const payload = {
      ...store,
      sections: parseSections(store.sections),
      ideasForYou: parseIdeasForYou(store.ideasForYou),
      followerCount: store._count?.followers ?? 0,
      construct: {
        startingImageUrl: construct.startingImageUrl ?? null,
        bannerImageUrl: construct.bannerImageUrl ?? null,
      },
    };
    res.json(payload);
  })
);

/** POST /api/microstores/store-for-me - force refresh store (re-run curation) then return; if no store yet, get-or-create */
router.post(
  "/store-for-me",
  requireAuth,
  asyncHandler(async (req, res) => {
    let store = await refreshStoreForUser(req.userId);
    if (!store) store = await getOrCreateStoreForUser(req.userId);
    if (!store) return res.status(400).json({ error: "Could not get or create store" });
    const { getStoreForYouConstruct } = await import("../domain/storeForYouConstruct/storeForYouConstruct.js");
    const construct = await getStoreForYouConstruct();
    const payload = {
      ...store,
      sections: parseSections(store.sections),
      ideasForYou: parseIdeasForYou(store.ideasForYou),
      followerCount: store._count?.followers ?? 0,
      construct: {
        startingImageUrl: construct.startingImageUrl ?? null,
        bannerImageUrl: construct.bannerImageUrl ?? null,
      },
    };
    res.json(payload);
  })
);

/** POST /api/microstores/suggest-name — suggest name & details for creation wizard (allowed creators only) */
router.post(
  "/suggest-name",
  requireAuth,
  asyncHandler(async (req, res) => {
    const allowed = await allowedMicrostoreCreators.canCreateMicrostore(req.userId, req.user?.role);
    if (!allowed) return res.status(403).json({ error: "Not allowed to create microstores" });
    const result = await suggestMicrostoreName(req.body || {});
    res.json(result);
  })
);

/** POST /api/microstores/suggest-products — suggest products for wizard (allowed creators only) */
router.post(
  "/suggest-products",
  requireAuth,
  asyncHandler(async (req, res) => {
    const allowed = await allowedMicrostoreCreators.canCreateMicrostore(req.userId, req.user?.role);
    if (!allowed) return res.status(403).json({ error: "Not allowed to create microstores" });
    const result = await suggestProductsForMicrostore(req.body || {});
    res.json(result);
  })
);

/** POST /api/microstores/suggest-one-style-note — suggest a single style card (allowed creators only) */
router.post(
  "/suggest-one-style-note",
  requireAuth,
  asyncHandler(async (req, res) => {
    const allowed = await allowedMicrostoreCreators.canCreateMicrostore(req.userId, req.user?.role);
    if (!allowed) return res.status(403).json({ error: "Not allowed to create microstores" });
    const result = await suggestOneStyleNote(req.body || {});
    res.json(result);
  })
);

/** POST /api/microstores/generate-cover — generate cover image for wizard (allowed creators only) */
router.post(
  "/generate-cover",
  requireAuth,
  asyncHandler(async (req, res) => {
    const allowed = await allowedMicrostoreCreators.canCreateMicrostore(req.userId, req.user?.role);
    if (!allowed) return res.status(403).json({ error: "Not allowed to create microstores" });
    const body = req.body || {};
    const result = await generateMicrostoreCoverImage({
      name: body.name,
      description: body.description,
      vibe: body.vibe,
      trends: body.trends,
      categories: body.categories,
      referenceImageUrl: body.referenceImageUrl,
    });
    res.json(result);
  })
);

/** POST /api/microstores — create microstore (allowed creators only); creates as draft. Use forCommunity: true for community store (admin approval, then microstore page); otherwise personal. */
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const allowed = await allowedMicrostoreCreators.canCreateMicrostore(req.userId, req.user?.role);
    if (!allowed) return res.status(403).json({ error: "Not allowed to create microstores" });
    const body = req.body || {};
    const forCommunity = body.forCommunity === true;
    const created = await createMicrostore({
      ...body,
      createdBy: "user",
      createdByUserId: forCommunity ? null : req.userId,
      status: body.status || "draft",
    });
    res.status(201).json(created);
  })
);

/** GET /api/microstores/:id - get one; optional auth for visibility */
router.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const store = await getMicrostore(req.params.id, req.userId ?? null, false);
    if (!store) return res.status(404).json({ error: "Microstore not found" });
    // Personal stores (Store for you) are strictly owner-only
    if (isPersonalStore(store)) {
      const ownerId = getPersonalStoreOwnerId(store);
      if (req.userId == null || ownerId !== req.userId) return res.status(404).json({ error: "Microstore not found" });
    }
    const payload = {
      ...store,
      coverImageUrl: resolveCoverImageUrlForClient(store.coverImageUrl) ?? store.coverImageUrl,
      sections: parseSections(store.sections),
      followerCount: store._count?.followers ?? 0,
      styleNotes: typeof store.styleNotes === "string" ? (() => { try { return JSON.parse(store.styleNotes); } catch { return null; } })() : store.styleNotes,
    };
    res.json(payload);
  })
);

/** PUT /api/microstores/:id - update microstore (owner or admin only) */
router.put(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const store = await getMicrostore(req.params.id, req.userId ?? null, req.user?.role === "admin");
    if (!store) return res.status(404).json({ error: "Microstore not found" });
    const isOwner = store.createdByUserId === req.userId;
    const isAdmin = req.user?.role === "admin";
    if (!isOwner && !isAdmin) return res.status(403).json({ error: "Not allowed to edit this store" });
    const updated = await updateMicrostore(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: "Microstore not found" });
    const payload = {
      ...updated,
      coverImageUrl: resolveCoverImageUrlForClient(updated.coverImageUrl) ?? updated.coverImageUrl,
      sections: parseSections(updated.sections),
      followerCount: updated._count?.followers ?? 0,
      styleNotes: typeof updated.styleNotes === "string" ? (() => { try { return JSON.parse(updated.styleNotes); } catch { return null; } })() : updated.styleNotes,
    };
    res.json(payload);
  })
);

/** POST /api/microstores/:id/upload-cover - upload cover image (owner or admin); stores under generated/ so it loads without auth */
router.post(
  "/:id/upload-cover",
  requireAuth,
  coverUpload.single("file"),
  asyncHandler(async (req, res) => {
    const store = await getMicrostore(req.params.id, req.userId ?? null, req.user?.role === "admin");
    if (!store) return res.status(404).json({ error: "Microstore not found" });
    const isOwner = store.createdByUserId === req.userId;
    const isAdmin = req.user?.role === "admin";
    if (!isOwner && !isAdmin) return res.status(403).json({ error: "Not allowed to edit this store" });
    const file = req.file;
    if (!file || !file.buffer) return res.status(400).json({ error: "File required (image only: jpeg, png, webp, gif)" });
    const contentType = file.mimetype || "image/webp";
    const key = `generated/cover-${req.params.id}-${randomUUID()}`;
    const { url } = await uploadFile(file.buffer, key, contentType, { requireRemote: false });
    const updated = await updateMicrostore(req.params.id, { coverImageUrl: url });
    if (!updated) return res.status(404).json({ error: "Microstore not found" });
    const resolved = resolveCoverImageUrlForClient(updated.coverImageUrl) ?? updated.coverImageUrl;
    res.json({ coverImageUrl: resolved });
  })
);

/** POST /api/microstores/:id/submit-for-approval - submit draft for approval (owner or admin) */
router.post(
  "/:id/submit-for-approval",
  requireAuth,
  asyncHandler(async (req, res) => {
    const store = await getMicrostore(req.params.id, req.userId ?? null, req.user?.role === "admin");
    if (!store) return res.status(404).json({ error: "Microstore not found" });
    const isOwner = store.createdByUserId === req.userId;
    const isAdmin = req.user?.role === "admin";
    if (!isOwner && !isAdmin) return res.status(403).json({ error: "Not allowed to submit this store" });
    try {
      const updated = await submitMicrostoreForApproval(req.params.id);
      if (!updated) return res.status(404).json({ error: "Microstore not found" });
      const payload = {
        ...updated,
        coverImageUrl: resolveCoverImageUrlForClient(updated.coverImageUrl) ?? updated.coverImageUrl,
        sections: parseSections(updated.sections),
        followerCount: updated._count?.followers ?? 0,
        styleNotes: typeof updated.styleNotes === "string" ? (() => { try { return JSON.parse(updated.styleNotes); } catch { return null; } })() : updated.styleNotes,
      };
      res.json(payload);
    } catch (err) {
      if (err.message?.includes("must be in draft")) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  })
);

/** POST /api/microstores/:id/follow - follow store (auth required) */
router.post(
  "/:id/follow",
  requireAuth,
  asyncHandler(async (req, res) => {
    const store = await followMicrostore(req.params.id, req.userId);
    if (!store) return res.status(404).json({ error: "Microstore not found" });
    triggerBuildPreferenceGraph(req.userId);
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
    triggerBuildPreferenceGraph(req.userId);
    res.json({ followed: false, store: { id: store.id, followerCount: store._count?.followers ?? 0 } });
  })
);

export default router;
