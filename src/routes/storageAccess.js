/**
 * GET /api/storage/access — permission-checked access to stored images (R2 or local).
 * Query: url=<encoded stored URL> or key=<storage key>. Optional: access_token=<short-lived JWT> for cross-origin img.
 * Returns 302 redirect to presigned URL (R2) or /uploads/key (local). No auth for admin-test/*; auth required for all others.
 * Avatars (styling-avatars/*) require any authenticated user; user content requires ownership.
 */
import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { optionalAuth, requireAuth } from "../middleware/requireAuth.js";
import { verifyStorageAccessToken, createStorageAccessToken } from "../domain/user/auth.js";
import {
  urlToStorageKey,
  getPresignedGetUrl,
  getR2PublicBaseUrl,
  getStorageObject,
  getLocalObject,
} from "../utils/storage.js";

const R2_ENABLED = process.env.R2_ENABLED === "true";
const router = Router();

router.get(
  "/access",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const urlParam = (req.query.url ?? "").toString().trim();
    const keyParam = (req.query.key ?? "").toString().trim();
    const accessTokenParam = (req.query.access_token ?? req.query.token ?? "").toString().trim();
    let key = null;
    if (keyParam && !keyParam.includes("..")) {
      key = keyParam;
    } else if (urlParam) {
      key = urlToStorageKey(decodeURIComponent(urlParam));
    }
    if (!key) {
      return res.status(400).json({ error: "url or key required" });
    }

    let userId = req.userId || null;
    if (!userId && accessTokenParam) {
      const payload = verifyStorageAccessToken(accessTokenParam);
      if (payload?.userId) userId = payload.userId;
    }

    // Public keys: no auth required (generated/* = AI-generated cover images, used in img src without credentials)
    if (key.startsWith("admin-test/") || key.startsWith("generated/")) {
      // allow
    } else {
      if (!userId) {
        return res.status(401).json({ error: "Authorization required" });
      }
      // Auth-required: check ownership for user-scoped keys
      const parts = key.split("/");
      if (key.startsWith("user-images/") && parts.length >= 2) {
        if (parts[1] !== userId) return res.status(403).json({ error: "Forbidden" });
      } else if (key.startsWith("wardrobe/") && parts.length >= 2) {
        const wardrobeUserId = parts[1];
        if (wardrobeUserId !== userId) return res.status(403).json({ error: "Forbidden" });
      } else if (key.startsWith("feed-posts/") && parts.length >= 2) {
        if (parts[1] !== userId) return res.status(403).json({ error: "Forbidden" });
      } else if (key.startsWith("looks/") && parts.length >= 2) {
        if (parts[1] !== "anon" && parts[1] !== userId) return res.status(403).json({ error: "Forbidden" });
      }
      // styling-avatars/*, generated/*: any authenticated user
    }

    // For generated/* (cover images): stream the image so img src gets 200 + body (no redirect/CORS issues)
    if (key.startsWith("generated/")) {
      const obj = await getStorageObject(key);
      if (obj && obj.body) {
        res.setHeader("Content-Type", obj.contentType || "image/webp");
        res.setHeader("Cache-Control", "private, max-age=3600");
        obj.body.pipe(res);
        return;
      }
      return res.status(404).send();
    }

    if (R2_ENABLED && getR2PublicBaseUrl()) {
      const presigned = await getPresignedGetUrl(key, 3600);
      if (presigned) {
        return res.redirect(302, presigned);
      }
    }

    // For local storage: stream the file so the browser gets the image in one request (avoids broken images from redirect)
    const localObj = getLocalObject(key);
    if (localObj && localObj.body) {
      res.setHeader("Content-Type", localObj.contentType || "image/jpeg");
      res.setHeader("Cache-Control", "private, max-age=3600");
      localObj.body.pipe(res);
      return;
    }

    return res.redirect(302, "/uploads/" + key);
  })
);

router.get(
  "/access-token",
  requireAuth,
  asyncHandler(async (req, res) => {
    const token = createStorageAccessToken(req.userId);
    res.json({ token });
  })
);

export default router;
