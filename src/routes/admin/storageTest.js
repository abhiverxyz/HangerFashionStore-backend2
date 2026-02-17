/**
 * Admin: R2 / image storage test routes.
 * GET /storage-status, POST /storage-test/upload, POST /storage-test/verify, GET /storage-test/proxy
 */
import { Router } from "express";
import { asyncHandler } from "../../core/asyncHandler.js";
import {
  getStorageStatus,
  uploadFile,
  getR2PublicBaseUrl,
  headR2Object,
  getStorageObject,
} from "../../utils/storage.js";
import multer from "multer";

const router = Router();

const storageTestUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype &&
      ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"].includes(
        file.mimetype.toLowerCase()
      );
    cb(null, !!ok);
  },
});

router.get(
  "/storage-status",
  asyncHandler(async (_req, res) => {
    const status = await getStorageStatus();
    res.json(status);
  })
);

router.post(
  "/storage-test/upload",
  storageTestUpload.single("file"),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file || !file.buffer) {
      return res.status(400).json({ error: "File required (image: jpeg, png, webp, gif)" });
    }
    const contentType = file.mimetype || "image/jpeg";
    const safeName = (file.originalname || "image").replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 60);
    const key = `admin-test/${Date.now()}-${safeName}`;
    const result = await uploadFile(file.buffer, key, contentType, { requireRemote: false });
    const storageMode = result.url.startsWith("http") ? "r2" : "local";
    res.status(201).json({ ...result, storageMode });
  })
);

router.post(
  "/storage-test/verify",
  asyncHandler(async (req, res) => {
    const { url } = req.body || {};
    const urlStr = (url || "").trim();
    if (!urlStr) return res.status(400).json({ error: "url is required" });

    const baseUrl = getR2PublicBaseUrl();
    if (baseUrl) {
      const base = baseUrl.replace(/\/$/, "");
      if (urlStr.startsWith(base + "/") || urlStr === base) {
        const key = urlStr.slice(base.length).replace(/^\//, "");
        if (key) {
          const { exists, contentType } = await headR2Object(key);
          return res.json({
            ok: exists,
            statusCode: exists ? 200 : 404,
            contentType,
          });
        }
      }
    }

    try {
      const head = await fetch(urlStr, { method: "GET", redirect: "follow" });
      res.json({
        ok: head.ok,
        statusCode: head.status,
        contentType: head.headers.get("content-type") || undefined,
      });
    } catch (err) {
      res.status(200).json({
        ok: false,
        statusCode: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })
);

router.get(
  "/storage-test/proxy",
  asyncHandler(async (req, res) => {
    const key = (req.query.key || "").trim();
    if (!key || key.includes("..")) return res.status(400).json({ error: "key is required" });
    const obj = await getStorageObject(key);
    if (!obj) return res.status(404).json({ error: "Not found" });
    res.setHeader("Content-Type", obj.contentType);
    obj.body.pipe(res);
  })
);

export default router;
