import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { uploadFile } from "../utils/storage.js";
import { createUserImage, listUserImages } from "../domain/userImage/userImage.js";

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

/** GET /api/user-images - list current user's images */
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { limit, offset } = req.query;
    const result = await listUserImages({
      userId: req.userId,
      limit,
      offset,
    });
    res.json(result);
  })
);

/** POST /api/user-images/upload - multipart file; creates UserImage (generic upload) */
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
    const key = `user-images/${req.userId}/${randomUUID()}`;
    const { url } = await uploadFile(file.buffer, key, contentType, { requireRemote: true });
    const context = (req.body && req.body.context) || null;
    const record = await createUserImage({
      userId: req.userId,
      rawImageUrl: url,
      context,
    });
    res.status(201).json(record);
  })
);

export default router;
