import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { uploadFile } from "../utils/storage.js";
import * as wardrobeDomain from "../domain/wardrobe/wardrobe.js";

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
