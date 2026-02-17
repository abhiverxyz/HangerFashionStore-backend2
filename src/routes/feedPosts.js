/**
 * Content Feed (B9) — feed posts: list, get, create, edit, delete, upload, from-link.
 */
import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { asyncHandler } from "../core/asyncHandler.js";
import { optionalAuth, requireAuth } from "../middleware/requireAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { uploadFile } from "../utils/storage.js";
import * as contentFeed from "../domain/contentFeed/contentFeed.js";

const router = Router();

const IMAGE_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"];
const ALLOWED_MIMES = [...IMAGE_MIMES, ...VIDEO_MIMES];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype && ALLOWED_MIMES.includes(file.mimetype.toLowerCase());
    cb(null, !!ok);
  },
});

/** GET /api/feed-posts — list; optionalAuth; public sees only approved+active when active=true */
router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const {
      active,
      type,
      approvalStatus,
      createdBy,
      contentType,
      brandId,
      userId,
      limit,
      offset,
    } = req.query;
    const opts = {
      active: active === "true" ? true : active === "false" ? false : undefined,
      type,
      approvalStatus,
      createdBy,
      contentType,
      brandId,
      userId,
      limit,
      offset,
    };
    if (active === "true" && !req.userId) {
      opts.active = true;
      opts.approvalStatus = "approved";
    }
    const result = await contentFeed.listFeedPosts(opts);
    res.json({ posts: result.items, total: result.total });
  })
);

/** POST /api/feed-posts/upload — multipart image or video; returns { imageUrl } or { videoUrl } */
router.post(
  "/upload",
  requireAuth,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({
        error: "File required (image: jpeg, png, webp, gif; video: mp4, webm, mov)",
      });
    }
    const contentType = file.mimetype || "image/jpeg";
    const isVideo = VIDEO_MIMES.includes(contentType.toLowerCase());
    const key = `feed-posts/${req.userId}/${randomUUID()}`;
    const { url } = await uploadFile(file.buffer, key, contentType, { requireRemote: false });
    if (isVideo) {
      return res.status(201).json({ videoUrl: url, imageUrl: null });
    }
    res.status(201).json({ imageUrl: url, videoUrl: null });
  })
);

/** POST /api/feed-posts/from-link — create draft from URL; requireAuth */
router.post(
  "/from-link",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { url, type, title: titleOverride } = req.body || {};
    const urlStr = (url || "").trim();
    if (!urlStr) return res.status(400).json({ error: "url is required" });
    let createdBy = "user";
    let createdByUserId = req.userId;
    let brandId = null;
    if (req.user?.role === "admin") createdBy = "admin";
    if (req.user?.role === "brand" && req.user?.brandId) {
      createdBy = "brand";
      brandId = req.user.brandId;
    }
    try {
      const post = await contentFeed.createFeedPostFromLink(urlStr, {
        createdBy,
        createdByUserId,
        brandId,
        type: type || "drop",
        titleOverride: titleOverride || undefined,
      });
      res.status(201).json({ post });
    } catch (err) {
      if (err.message?.includes("Failed to fetch")) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  })
);

/** POST /api/feed-posts — admin create */
router.post(
  "/",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const post = await contentFeed.createFeedPost({
      ...body,
      createdBy: "admin",
      createdByUserId: req.user?.id ?? null,
    });
    res.status(201).json({ post });
  })
);

/** GET /api/feed-posts/:id */
router.get(
  "/:id",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const post = await contentFeed.getFeedPost(req.params.id);
    if (!post) return res.status(404).json({ error: "Feed post not found" });
    res.json({ post });
  })
);

/** PUT /api/feed-posts/:id — admin edit */
router.put(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const updated = await contentFeed.updateFeedPost(req.params.id, req.body || {}, {
      adminCanEditAny: true,
    });
    if (!updated) return res.status(404).json({ error: "Feed post not found" });
    res.json({ post: updated });
  })
);

/** DELETE /api/feed-posts/:id — admin delete */
router.delete(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = await contentFeed.deleteFeedPost(req.params.id);
    if (!result) return res.status(404).json({ error: "Feed post not found" });
    res.status(204).send();
  })
);

export default router;
