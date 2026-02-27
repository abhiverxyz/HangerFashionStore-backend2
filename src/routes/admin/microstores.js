/**
 * Admin: microstores and microstore-creation-context.
 */
import { Router } from "express";
import { asyncHandler } from "../../core/asyncHandler.js";
import * as microstore from "../../domain/microstore/microstore.js";
import * as creationContext from "../../domain/microstore/creationContext.js";
import {
  runMicrostoreCuration,
  suggestMicrostoreName,
  suggestProductsForMicrostore,
  createSystemMicrostoresBatch,
  startSystemMicrostoresBatch,
} from "../../agents/microstoreCurationAgent.js";
import { urlToStorageKey } from "../../utils/storage.js";

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

function resolveCoverImageUrlForClient(coverImageUrl) {
  if (!coverImageUrl || typeof coverImageUrl !== "string") return coverImageUrl;
  let key = urlToStorageKey(coverImageUrl.trim());
  if (!key) key = fallbackKeyFromUrl(coverImageUrl);
  if (key) return `/api/storage/access?key=${encodeURIComponent(key)}`;
  return coverImageUrl;
}

const router = Router();

router.get(
  "/microstores",
  asyncHandler(async (req, res) => {
    const { brandId, status, limit, offset } = req.query;
    const result = await microstore.listMicrostores({
      userId: null,
      adminBypass: true,
      excludeSingleUser: true,
      brandId,
      status,
      limit,
      offset,
    });
    const items = result.items.map((s) => ({
      ...s,
      coverImageUrl: resolveCoverImageUrlForClient(s.coverImageUrl) ?? s.coverImageUrl,
      sections: microstore.parseSections(s.sections),
      followerCount: s._count?.followers ?? 0,
      productCount: s._count?.products ?? 0,
    }));
    res.json({ items, total: result.total });
  })
);

router.post(
  "/microstores/suggest-name",
  asyncHandler(async (req, res) => {
    const result = await suggestMicrostoreName(req.body || {});
    res.json(result);
  })
);

router.post(
  "/microstores/suggest-products",
  asyncHandler(async (req, res) => {
    const result = await suggestProductsForMicrostore(req.body || {});
    res.json(result);
  })
);

router.post(
  "/microstores/create-system-batch",
  asyncHandler(async (req, res) => {
    const count = Math.min(10, Math.max(1, Number(req.body?.count) || 5));
    startSystemMicrostoresBatch(count);
    res.status(202).json({ accepted: true, message: `Creating ${count} system microstores in background.` });
  })
);

router.post(
  "/microstores/run-system-batch",
  asyncHandler(async (req, res) => {
    const count = Math.min(10, Math.max(1, Number(req.body?.count) || 5));
    const result = await createSystemMicrostoresBatch(count);
    res.json(result);
  })
);

router.post(
  "/microstores/bulk",
  asyncHandler(async (req, res) => {
    const { action, ids } = req.body || {};
    const validActions = ["archive", "publish", "delete"];
    if (!validActions.includes(action) || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "body must include action (archive|publish|delete) and non-empty ids array" });
    }
    const idList = ids.filter((id) => typeof id === "string" && id.trim()).slice(0, 100);
    const results = { successCount: 0, errors: [] };
    for (const id of idList) {
      try {
        if (action === "publish") {
          const updated = await microstore.publishMicrostore(id);
          if (updated) results.successCount++;
          else results.errors.push({ id, error: "Not found" });
        } else if (action === "archive") {
          const updated = await microstore.archiveMicrostore(id);
          if (updated) results.successCount++;
          else results.errors.push({ id, error: "Not found" });
        } else if (action === "delete") {
          const updated = await microstore.deleteMicrostore(id);
          if (updated) results.successCount++;
          else results.errors.push({ id, error: "Not found" });
        }
      } catch (err) {
        results.errors.push({ id, error: err?.message ?? "Failed" });
      }
    }
    res.json(results);
  })
);

router.get(
  "/microstores/:id",
  asyncHandler(async (req, res) => {
    const store = await microstore.getMicrostore(req.params.id, null, true);
    if (!store) return res.status(404).json({ error: "Microstore not found" });
    const styleNotes =
      typeof store.styleNotes === "string"
        ? (() => {
            try {
              return JSON.parse(store.styleNotes);
            } catch {
              return null;
            }
          })()
        : store.styleNotes;
    res.json({
      ...store,
      coverImageUrl: resolveCoverImageUrlForClient(store.coverImageUrl) ?? store.coverImageUrl,
      sections: microstore.parseSections(store.sections),
      followerCount: store._count?.followers ?? 0,
      styleNotes,
    });
  })
);

router.post(
  "/microstores",
  asyncHandler(async (req, res) => {
    const created = await microstore.createMicrostore(req.body || {});
    res.status(201).json(created);
  })
);

router.put(
  "/microstores/:id",
  asyncHandler(async (req, res) => {
    const updated = await microstore.updateMicrostore(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: "Microstore not found" });
    res.json(updated);
  })
);

router.put(
  "/microstores/:id/products",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const store = await microstore.getMicrostore(id, null, true);
    if (!store) return res.status(404).json({ error: "Microstore not found" });
    const { sections } = req.body || {};
    const scopeBrandId = store.brandId ?? null;
    const updated = await microstore.setMicroStoreProducts(id, sections, scopeBrandId);
    if (!updated) return res.status(404).json({ error: "Microstore not found" });
    res.json(updated);
  })
);

router.post(
  "/microstores/:id/publish",
  asyncHandler(async (req, res) => {
    const updated = await microstore.publishMicrostore(req.params.id);
    if (!updated) return res.status(404).json({ error: "Microstore not found" });
    res.json(updated);
  })
);

router.post(
  "/microstores/:id/approve",
  asyncHandler(async (req, res) => {
    try {
      const updated = await microstore.approveMicrostore(req.params.id);
      if (!updated) return res.status(404).json({ error: "Microstore not found" });
      res.json(updated);
    } catch (err) {
      if (err.message?.includes("must be pending_approval")) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  })
);

router.post(
  "/microstores/:id/reject",
  asyncHandler(async (req, res) => {
    try {
      const updated = await microstore.rejectMicrostore(req.params.id);
      if (!updated) return res.status(404).json({ error: "Microstore not found" });
      res.json(updated);
    } catch (err) {
      if (err.message?.includes("must be pending_approval")) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }
  })
);

router.post(
  "/microstores/:id/archive",
  asyncHandler(async (req, res) => {
    const updated = await microstore.archiveMicrostore(req.params.id);
    if (!updated) return res.status(404).json({ error: "Microstore not found" });
    res.json(updated);
  })
);

router.delete(
  "/microstores/:id",
  asyncHandler(async (req, res) => {
    const updated = await microstore.deleteMicrostore(req.params.id);
    if (!updated) return res.status(404).json({ error: "Microstore not found" });
    res.status(204).send();
  })
);

router.put(
  "/microstores/:id/visibility",
  asyncHandler(async (req, res) => {
    const updated = await microstore.setMicrostoreVisibility(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: "Microstore not found" });
    res.json(updated);
  })
);

router.post(
  "/microstores/suggest",
  asyncHandler(async (req, res) => {
    const result = await runMicrostoreCuration(req.body || {});
    res.json(result);
  })
);

// ---------- MicroStore Creation Context ----------
router.get(
  "/microstore-creation-context",
  asyncHandler(async (req, res) => {
    const { isActive, limit, offset } = req.query;
    const result = await creationContext.listCreationContexts({
      isActive: isActive === "true" ? true : isActive === "false" ? false : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    res.json(result);
  })
);

router.put(
  "/microstore-creation-context/reorder",
  asyncHandler(async (req, res) => {
    const { updates } = req.body || {};
    await creationContext.reorderCreationContexts(Array.isArray(updates) ? updates : []);
    res.json({ success: true });
  })
);

router.get(
  "/microstore-creation-context/:id",
  asyncHandler(async (req, res) => {
    const entry = await creationContext.getCreationContext(req.params.id);
    if (!entry) return res.status(404).json({ error: "Creation context not found" });
    res.json(entry);
  })
);

router.post(
  "/microstore-creation-context",
  asyncHandler(async (req, res) => {
    const created = await creationContext.createCreationContext(req.body || {});
    res.status(201).json(created);
  })
);

router.put(
  "/microstore-creation-context/:id",
  asyncHandler(async (req, res) => {
    const updated = await creationContext.updateCreationContext(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: "Creation context not found" });
    res.json(updated);
  })
);

router.delete(
  "/microstore-creation-context/:id",
  asyncHandler(async (req, res) => {
    await creationContext.deleteCreationContext(req.params.id);
    res.status(204).send();
  })
);

export default router;
