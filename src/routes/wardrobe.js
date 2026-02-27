import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { uploadFile } from "../utils/storage.js";
import * as wardrobeDomain from "../domain/wardrobe/wardrobe.js";
import * as wardrobeExtractionDomain from "../domain/wardrobe/wardrobeExtraction.js";
import { getLook } from "../domain/looks/look.js";
import { analyzeItem, extractFromLook, suggestForItem } from "../agents/wardrobeAgent.js";

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

/** GET /api/wardrobe - list current user's wardrobe (excludes full look images by default) */
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { limit, offset, category, excludeSource } = req.query;
    const result = await wardrobeDomain.listWardrobe({
      userId: req.userId,
      limit,
      offset,
      category: category || undefined,
      excludeSource: excludeSource === "false" ? undefined : excludeSource || "look",
    });
    res.json(result);
  })
);

/** GET /api/wardrobe/extractions - list extraction results for "Extracted looks" carousel */
router.get(
  "/extractions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { status, limit, offset } = req.query;
    const result = await wardrobeExtractionDomain.listWardrobeExtractions({
      userId: req.userId,
      status: status || "done",
      limit,
      offset,
    });
    res.json(result);
  })
);

/** DELETE /api/wardrobe/extractions/:id - delete an extracted look (and its slots from the carousel) */
router.delete(
  "/extractions/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const extraction = await wardrobeExtractionDomain.getWardrobeExtraction(req.params.id);
    if (!extraction) return res.status(404).json({ error: "Extraction not found" });
    if (extraction.userId !== req.userId) return res.status(403).json({ error: "Forbidden" });
    await wardrobeExtractionDomain.deleteWardrobeExtraction(req.params.id);
    res.status(204).send();
  })
);

/** POST /api/wardrobe/add-from-look - add look image to wardrobe immediately, run extraction in background */
router.post(
  "/add-from-look",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { lookId, imageUrl } = req.body || {};
    if (!lookId && !imageUrl) {
      return res.status(400).json({ error: "Provide lookId or imageUrl" });
    }
    let resolvedImageUrl = imageUrl;
    if (lookId) {
      const look = await getLook(lookId);
      if (!look) return res.status(404).json({ error: "Look not found" });
      if (look.userId && look.userId !== req.userId) {
        return res.status(403).json({ error: "Forbidden: you can only add your own look" });
      }
      resolvedImageUrl = look.imageUrl || resolvedImageUrl;
    }
    if (!resolvedImageUrl || typeof resolvedImageUrl !== "string") {
      return res.status(400).json({ error: "Could not resolve image URL for this look" });
    }

    const wardrobeItem = await wardrobeDomain.createWardrobeItem({
      userId: req.userId,
      imageUrl: resolvedImageUrl,
      brand: null,
      category: null,
      color: null,
      size: null,
      tags: null,
      source: "look",
    });

    const extraction = await wardrobeExtractionDomain.createWardrobeExtraction({
      userId: req.userId,
      lookId: lookId || null,
      imageUrl: resolvedImageUrl,
      status: "pending",
    });

    (async () => {
      try {
        await wardrobeExtractionDomain.updateWardrobeExtraction(extraction.id, { status: "extracting" });
        const result = await extractFromLook(
          { lookId: lookId || undefined, imageUrl: resolvedImageUrl },
          { userId: req.userId }
        );
        await wardrobeExtractionDomain.updateWardrobeExtraction(extraction.id, {
          status: "done",
          slots: result.slots,
        });
      } catch (err) {
        await wardrobeExtractionDomain.updateWardrobeExtraction(extraction.id, {
          status: "failed",
          error: err?.message || "Extraction failed",
        });
      }
    })();

    res.status(201).json({ wardrobeItem, extractionId: extraction.id });
  })
);

/** POST /api/wardrobe/upload - multipart file; creates wardrobe item with stored imageUrl, then analyzes in background */
router.post(
  "/upload",
  requireAuth,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    console.log("[wardrobe/upload]", req.userId, req.file ? "file" : "no file", req.headers["content-type"]?.slice(0, 50));
    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({ error: "File required (image only: jpeg, png, webp, gif)" });
    }
    const contentType = file.mimetype || "image/jpeg";
    const key = `wardrobe/${req.userId}/${randomUUID()}`;
    let url;
    try {
      const result = await uploadFile(file.buffer, key, contentType, { requireRemote: false });
      url = result.url;
    } catch (err) {
      console.error("[wardrobe/upload] Storage failed:", err?.message);
      return res.status(502).json({ error: "Storage failed. Please try again." });
    }
    const { brand, category, color, size, tags } = req.body || {};
    let item;
    try {
      item = await wardrobeDomain.createWardrobeItem({
        userId: req.userId,
        imageUrl: url,
        brand: brand || null,
        category: category || null,
        color: color || null,
        size: size || null,
        tags: tags || null,
        source: "upload",
      });
    } catch (err) {
      console.error("[wardrobe/upload] Could not save item:", err?.message);
      return res.status(500).json({ error: "Could not save item. Please try again." });
    }
    // Background: full wardrobe agent analyzes item and updates category, color, tags
    (async () => {
      try {
        const analyzed = await analyzeItem(file.buffer);
        const updates = {};
        if (analyzed.category != null && String(analyzed.category).trim()) updates.category = analyzed.category.trim();
        if (analyzed.color != null && String(analyzed.color).trim()) updates.color = analyzed.color.trim();
        if (analyzed.tags != null && String(analyzed.tags).trim()) updates.tags = analyzed.tags.trim();
        if (Object.keys(updates).length > 0) {
          await wardrobeDomain.updateWardrobeItem(item.id, updates);
        }
      } catch (err) {
        console.warn("[wardrobe/upload] Background analysis failed:", err?.message);
      }
    })();
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
    const result = await extractFromLook(
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

/** POST /api/wardrobe/accept-suggestions — Body: { productIds, extractionId?, extractionSlotIndex? }. Creates wardrobe items for selected products. */
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
      extractionId: body.extractionId ?? undefined,
      extractionSlotIndex: body.extractionSlotIndex,
    });
    res.status(201).json({ created });
  })
);

/** POST /api/wardrobe - create with imageUrl; body: imageUrl, brand?, category?, extractionId?, extractionSlotIndex?, ... */
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { imageUrl, brand, category, color, size, tags, extractionId, extractionSlotIndex } = req.body || {};
    if (!imageUrl) return res.status(400).json({ error: "imageUrl required" });
    const item = await wardrobeDomain.createWardrobeItem({
      userId: req.userId,
      imageUrl,
      brand,
      category,
      color,
      size,
      tags,
      source: extractionId != null ? "extraction" : null,
      extractionId: extractionId ?? null,
      extractionSlotIndex: extractionSlotIndex != null ? Number(extractionSlotIndex) : null,
    });
    res.status(201).json(item);
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
