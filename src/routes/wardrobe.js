import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { uploadFile } from "../utils/storage.js";
import * as wardrobeDomain from "../domain/wardrobe/wardrobe.js";
import { run as runWardrobeExtraction, suggestForItem } from "../agents/wardrobeExtractionAgent.js";

const router = Router();
const IMAGE_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype && IMAGE_MIMES.includes(file.mimetype.toLowerCase());
    cb(null, !!ok);
  },
});

/** GET /api/wardrobe - list current user's wardrobe */
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { limit, offset, category } = req.query;
    const result = await wardrobeDomain.listWardrobe({
      userId: req.userId,
      limit,
      offset,
      category: category || undefined,
    });
    res.json(result);
  })
);

/** GET /api/wardrobe/:id */
router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const item = await wardrobeDomain.getWardrobeItem(req.params.id);
    if (!item) return res.status(404).json({ error: "Wardrobe item not found" });
    if (item.userId !== req.userId) return res.status(403).json({ error: "Forbidden" });
    res.json(item);
  })
);

/** POST /api/wardrobe/upload - multipart file; creates wardrobe item with stored imageUrl */
router.post(
  "/upload",
  requireAuth,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({ error: "File required (image only: jpeg, png, webp, gif)" });
    }
    const contentType = file.mimetype || "image/jpeg";
    const key = `wardrobe/${req.userId}/${randomUUID()}`;
    const { url } = await uploadFile(file.buffer, key, contentType, { requireRemote: true });
    const { brand, category, color, size, tags } = req.body || {};
    const item = await wardrobeDomain.createWardrobeItem({
      userId: req.userId,
      imageUrl: url,
      brand: brand || null,
      category: category || null,
      color: color || null,
      size: size || null,
      tags: tags || null,
    });
    res.status(201).json(item);
  })
);

/** POST /api/wardrobe/extract-from-look — B4.6. Body: { lookId } or { imageUrl }. Or multipart file (field: file). Returns extraction + suggested product IDs per slot. */
router.post(
  "/extract-from-look",
  requireAuth,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const { lookId, imageUrl } = req.body || {};
    let imageBuffer;
    if (req.file?.buffer) {
      imageBuffer = req.file.buffer;
    }
    if (!lookId && !imageUrl && !imageBuffer) {
      return res.status(400).json({ error: "Provide lookId, imageUrl, or upload an image file" });
    }
    const result = await runWardrobeExtraction(
      { lookId: lookId || undefined, imageUrl: imageUrl || undefined, imageBuffer },
      { userId: req.userId }
    );
    if (result.error && result.slots.length === 0) {
      const status = result.error === "Look not found" ? 404 : result.error.startsWith("Forbidden") ? 403 : 400;
      return res.status(status).json({ error: result.error, slots: [], look: result.look ?? null });
    }
    res.json({ slots: result.slots, look: result.look ?? null, error: result.error ?? null });
  })
);

/** POST /api/wardrobe/suggest-for-item — Get new product suggestions for one slot (resuggest). Body: { item: { description?, category_lvl1?, color_primary? }, limit? }. */
router.post(
  "/suggest-for-item",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const item = body.item;
    if (!item || typeof item !== "object") {
      return res.status(400).json({ error: "Body must include item: { description?, category_lvl1?, color_primary? }" });
    }
    const result = await suggestForItem(item, body.limit);
    res.json(result);
  })
);

/** POST /api/wardrobe/accept-suggestions — B4.6. Body: { productIds: string[] } or { selections: [ { productId } ] }. Creates wardrobe items for selected products. */
router.post(
  "/accept-suggestions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    let productIds = body.productIds;
    if (Array.isArray(body.selections)) {
      productIds = body.selections.map((s) => (typeof s === "object" && s != null ? s.productId : s)).filter(Boolean);
    }
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: "Provide productIds or selections array with productId" });
    }
    const { created } = await wardrobeDomain.createWardrobeItemsFromProducts({
      userId: req.userId,
      productIds,
    });
    res.status(201).json({ created });
  })
);

/** POST /api/wardrobe - create with imageUrl (e.g. from URL); body: imageUrl, brand?, category?, ... */
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { imageUrl, brand, category, color, size, tags } = req.body || {};
    if (!imageUrl) return res.status(400).json({ error: "imageUrl required" });
    const item = await wardrobeDomain.createWardrobeItem({
      userId: req.userId,
      imageUrl,
      brand,
      category,
      color,
      size,
      tags,
    });
    res.status(201).json(item);
  })
);

/** PUT /api/wardrobe/:id */
router.put(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await wardrobeDomain.getWardrobeItem(req.params.id);
    if (!existing) return res.status(404).json({ error: "Wardrobe item not found" });
    if (existing.userId !== req.userId) return res.status(403).json({ error: "Forbidden" });
    const item = await wardrobeDomain.updateWardrobeItem(req.params.id, req.body || {});
    res.json(item);
  })
);

/** DELETE /api/wardrobe/:id */
router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await wardrobeDomain.getWardrobeItem(req.params.id);
    if (!existing) return res.status(404).json({ error: "Wardrobe item not found" });
    if (existing.userId !== req.userId) return res.status(403).json({ error: "Forbidden" });
    await wardrobeDomain.deleteWardrobeItem(req.params.id);
    res.status(204).send();
  })
);

export default router;
