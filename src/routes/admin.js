import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { requireAdminOrSecret } from "../middleware/requireAdminOrSecret.js";
import { getPrisma } from "../core/db.js";
import {
  getEnrichmentQueueStats,
  getEnrichmentJobStatus,
  enqueueEnrichment,
  enqueueSyncShopify,
} from "../utils/queue.js";
import { importBrandFromPublicUrl, importBrandFromPublicPayload } from "../domain/product/importPublic.js";
import {
  getAllModelConfig,
  invalidateModelConfigCache,
  KNOWN_SCOPES,
} from "../config/modelConfig.js";
import { saveModelConfig } from "../config/modelConfigDb.js";
import * as fashionContent from "../domain/fashionContent/fashionContent.js";
import * as stylingAgentConfig from "../domain/stylingAgentConfig/stylingAgentConfig.js";
import * as lookClassificationTag from "../domain/lookClassificationTag/lookClassificationTag.js";
import { runFashionContentAgent } from "../agents/fashionContentAgent.js";

const router = Router();

// Import endpoints: allow ADMIN_SECRET (X-Admin-Secret or ?secret=) so CLI script can auth without JWT
router.post(
  "/import-public",
  requireAdminOrSecret,
  asyncHandler(async (req, res) => {
    const { url, brandName } = req.body || {};
    const urlInput = (url || "").trim();
    if (!urlInput) {
      return res.status(400).json({ error: "url is required" });
    }
    console.log("[admin] import-public request:", { url: urlInput, brandName: brandName || "(derive from URL)" });
    const result = await importBrandFromPublicUrl(urlInput, brandName?.trim() || undefined);
    console.log("[admin] import-public done:", result.summary);
    res.status(201).json({
      success: true,
      message: "Import completed; products enqueued for enrichment",
      summary: result.summary,
      brand: result.brand,
    });
  })
);

router.post(
  "/import-public-payload",
  requireAdminOrSecret,
  asyncHandler(async (req, res) => {
    const { url, brandName, products } = req.body || {};
    const urlInput = (url || "").trim();
    if (!urlInput) {
      return res.status(400).json({ error: "url is required" });
    }
    if (!Array.isArray(products)) {
      return res.status(400).json({ error: "products array is required" });
    }
    console.log("[admin] import-public-payload request:", { url: urlInput, productCount: products.length });
    const result = await importBrandFromPublicPayload(urlInput, brandName?.trim() || undefined, products);
    console.log("[admin] import-public-payload done:", result.summary);
    res.status(201).json({
      success: true,
      message: "Import completed; products enqueued for enrichment",
      summary: result.summary,
      brand: result.brand,
    });
  })
);

// All other admin routes require JWT
router.use(requireAdmin);

/** POST /api/admin/brands - body: { shopDomain, name } (optional: description, websiteUrl) */
router.post(
  "/brands",
  asyncHandler(async (req, res) => {
    const { shopDomain, name, description, websiteUrl } = req.body || {};
    const domain = (shopDomain || "").trim();
    const brandName = (name || "").trim();
    if (!domain || !brandName) {
      return res.status(400).json({ error: "shopDomain and name are required" });
    }
    const prisma = getPrisma();
    const existing = await prisma.brand.findUnique({ where: { shopDomain: domain } });
    if (existing) {
      return res.status(409).json({ error: "Brand with this shop domain already exists", brandId: existing.id });
    }
    const brand = await prisma.brand.create({
      data: {
        shopDomain: domain,
        name: brandName,
        description: description?.trim() || null,
        websiteUrl: websiteUrl?.trim() || null,
      },
    });
    res.status(201).json({
      id: brand.id,
      shopDomain: brand.shopDomain,
      name: brand.name,
      lastSyncedAt: brand.lastSyncedAt,
    });
  })
);

/** GET /api/admin/sync-status - last sync per brand + enrichment queue stats + per-brand product/enriched counts */
router.get(
  "/sync-status",
  asyncHandler(async (req, res) => {
    const prisma = getPrisma();
    const [brands, totalByBrand, enrichedByBrand] = await Promise.all([
      prisma.brand.findMany({
        select: { id: true, name: true, shopDomain: true, lastSyncedAt: true },
        orderBy: { name: "asc" },
      }),
      prisma.product.groupBy({
        by: ["brandId"],
        _count: { id: true },
      }),
      prisma.product.groupBy({
        by: ["brandId"],
        _count: { id: true },
        where: { enrichmentStatus: "completed" },
      }),
    ]);
    const totalMap = Object.fromEntries(totalByBrand.map((r) => [r.brandId, r._count.id]));
    const enrichedMap = Object.fromEntries(enrichedByBrand.map((r) => [r.brandId, r._count.id]));
    res.json({
      brands: brands.map((b) => ({
        id: b.id,
        name: b.name,
        shopDomain: b.shopDomain,
        lastSyncedAt: b.lastSyncedAt,
        importMode: "shopify_sync",
        productCount: totalMap[b.id] ?? 0,
        enrichedCount: enrichedMap[b.id] ?? 0,
      })),
      enrichmentQueue: await getEnrichmentQueueStats(),
    });
  })
);

/** GET /api/admin/enrich-status/:productId - job status for one product */
router.get(
  "/enrich-status/:productId",
  asyncHandler(async (req, res) => {
    const status = await getEnrichmentJobStatus(req.params.productId);
    res.json(status);
  })
);

/** POST /api/admin/enrich-product/:id - enqueue one product for enrichment */
router.post(
  "/enrich-product/:id",
  asyncHandler(async (req, res) => {
    const productId = req.params.id;
    const prisma = getPrisma();
    const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!product) return res.status(404).json({ error: "Product not found" });
    await enqueueEnrichment(productId, 50);
    res.json({ enqueued: productId, message: "Product queued for enrichment" });
  })
);

/** POST /api/admin/sync-shopify - body: { brandId, accessToken }. Enqueue sync job. */
router.post(
  "/sync-shopify",
  asyncHandler(async (req, res) => {
    const { brandId, accessToken } = req.body || {};
    if (!brandId || !accessToken) {
      return res.status(400).json({ error: "brandId and accessToken required" });
    }
    const prisma = getPrisma();
    const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } });
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    await enqueueSyncShopify(brandId, accessToken);
    res.json({ enqueued: brandId, message: "Brand queued for Shopify sync" });
  })
);

/** DELETE /api/admin/products/:id */
router.delete(
  "/products/:id",
  asyncHandler(async (req, res) => {
    const prisma = getPrisma();
    const product = await prisma.product.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!product) return res.status(404).json({ error: "Product not found" });
    await prisma.product.delete({ where: { id: req.params.id } });
    res.status(204).send();
  })
);

/** DELETE /api/admin/brands/:id - clears FeedPost refs then deletes brand (cascade removes products). */
router.delete(
  "/brands/:id",
  asyncHandler(async (req, res) => {
    const prisma = getPrisma();
    const brand = await prisma.brand.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    await prisma.feedPost.updateMany({ where: { brandId: req.params.id }, data: { brandId: null } });
    await prisma.brand.delete({ where: { id: req.params.id } });
    res.status(204).send();
  })
);

/** GET /api/admin/model-config - list all known scopes with current provider/model (DB or env fallback). */
router.get(
  "/model-config",
  asyncHandler(async (req, res) => {
    const config = await getAllModelConfig();
    res.json(config);
  })
);

/** PUT /api/admin/model-config - body: { scope, provider, model }. Upsert one scope; invalidate cache. */
router.put(
  "/model-config",
  asyncHandler(async (req, res) => {
    const { scope, provider, model } = req.body || {};
    const scopeStr = typeof scope === "string" ? scope.trim() : "";
    if (!scopeStr) return res.status(400).json({ error: "scope is required" });
    if (!KNOWN_SCOPES.includes(scopeStr)) {
      return res.status(400).json({
        error: `scope must be one of: ${KNOWN_SCOPES.join(", ")}`,
        allowedScopes: KNOWN_SCOPES,
      });
    }
    const providerStr = typeof provider === "string" ? provider.trim() : "";
    const modelStr = typeof model === "string" ? model.trim() : "";
    if (!providerStr || !modelStr) {
      return res.status(400).json({ error: "provider and model are required" });
    }
    await saveModelConfig(scopeStr, { provider: providerStr, model: modelStr });
    invalidateModelConfigCache(scopeStr);
    const updated = await getAllModelConfig();
    res.json(updated);
  })
);

// ---------- B1.3 Fashion Content: sources, allowlist, run agent ----------

/** GET /api/admin/fashion-content-sources - list (query: status?, limit?) */
router.get(
  "/fashion-content-sources",
  asyncHandler(async (req, res) => {
    const { status, limit } = req.query;
    const result = await fashionContent.listFashionContentSources({
      status: status || undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json(result);
  })
);

/** POST /api/admin/fashion-content-sources - body: { type: "url"|"text"|"image", payload: string } */
router.post(
  "/fashion-content-sources",
  asyncHandler(async (req, res) => {
    const { type, payload } = req.body || {};
    if (!type || !payload) {
      return res.status(400).json({ error: "type and payload are required" });
    }
    const created = await fashionContent.addFashionContentSource({
      type,
      payload: String(payload).trim(),
      createdBy: req.user?.id || null,
    });
    res.status(201).json(created);
  })
);

/** GET /api/admin/fashion-content-allowlist - list allowed domains for web fetch */
router.get(
  "/fashion-content-allowlist",
  asyncHandler(async (_req, res) => {
    const list = await fashionContent.listAllowedFashionDomains();
    res.json(list);
  })
);

/** POST /api/admin/fashion-content-allowlist - body: { domain: string } */
router.post(
  "/fashion-content-allowlist",
  asyncHandler(async (req, res) => {
    const { domain } = req.body || {};
    if (!domain) return res.status(400).json({ error: "domain is required" });
    const created = await fashionContent.addAllowedFashionDomain(domain);
    res.status(201).json(created);
  })
);

/** DELETE /api/admin/fashion-content-allowlist/:idOrDomain - remove by id or domain */
router.delete(
  "/fashion-content-allowlist/:idOrDomain",
  asyncHandler(async (req, res) => {
    const deleted = await fashionContent.removeAllowedFashionDomain(req.params.idOrDomain);
    res.json(deleted);
  })
);

/** POST /api/admin/run-fashion-content-agent - run agent now (body: { seed?: string }) */
router.post(
  "/run-fashion-content-agent",
  asyncHandler(async (req, res) => {
    const { seed } = req.body || {};
    const result = await runFashionContentAgent({ seed: seed || "" });
    res.json({ success: true, result });
  })
);

// ---------- Styling Agent improvement loop (avatars, playbook, goals) ----------

/** GET /api/admin/styling-avatars - list all avatars */
router.get(
  "/styling-avatars",
  asyncHandler(async (req, res) => {
    const avatars = await stylingAgentConfig.listAvatars();
    res.json(avatars);
  })
);

/** GET /api/admin/styling-avatars/default - get default avatar */
router.get(
  "/styling-avatars/default",
  asyncHandler(async (req, res) => {
    const avatar = await stylingAgentConfig.getDefaultAvatar();
    if (!avatar) return res.status(404).json({ error: "No avatar found" });
    res.json(avatar);
  })
);

/** PUT /api/admin/styling-avatars/default - set default avatar; body: { avatarId or avatarSlug } */
router.put(
  "/styling-avatars/default",
  asyncHandler(async (req, res) => {
    const { avatarId, avatarSlug } = req.body || {};
    const idOrSlug = avatarId || avatarSlug;
    if (!idOrSlug) return res.status(400).json({ error: "avatarId or avatarSlug required" });
    const avatar = await stylingAgentConfig.setDefaultAvatar(idOrSlug);
    res.json(avatar);
  })
);

/** PUT /api/admin/styling-avatars/:idOrSlug - create or update avatar; body: { name, slug?, description?, systemPromptAddition?, sortOrder?, isDefault? } */
router.put(
  "/styling-avatars/:idOrSlug",
  asyncHandler(async (req, res) => {
    const { name, slug, description, systemPromptAddition, sortOrder, isDefault } = req.body || {};
    const avatar = await stylingAgentConfig.upsertAvatar({
      id: req.params.idOrSlug,
      name,
      slug: slug || req.params.idOrSlug,
      description,
      systemPromptAddition,
      sortOrder,
      isDefault,
    });
    res.json(avatar);
  })
);

/** GET /api/admin/styling-playbook - list playbook entries (query: type?, isActive?) */
router.get(
  "/styling-playbook",
  asyncHandler(async (req, res) => {
    const type = req.query.type;
    const isActive = req.query.isActive !== undefined ? req.query.isActive === "true" : undefined;
    const entries = await stylingAgentConfig.listPlaybook({ type, isActive });
    res.json(entries);
  })
);

/** GET /api/admin/styling-playbook/goals - get goals content */
router.get(
  "/styling-playbook/goals",
  asyncHandler(async (req, res) => {
    const content = await stylingAgentConfig.getGoalsContent();
    res.json({ content });
  })
);

/** PUT /api/admin/styling-playbook/goals - set goals content; body: { content } */
router.put(
  "/styling-playbook/goals",
  asyncHandler(async (req, res) => {
    const { content } = req.body || {};
    await stylingAgentConfig.setGoalsContent(content);
    const updated = await stylingAgentConfig.getGoalsContent();
    res.json({ content: updated });
  })
);

/** POST /api/admin/styling-playbook - add playbook entry; body: { type: "instruction"|"example_flow", content, sortOrder?, isActive? } */
router.post(
  "/styling-playbook",
  asyncHandler(async (req, res) => {
    const { type, content, sortOrder, isActive } = req.body || {};
    if (!type || (type !== "instruction" && type !== "example_flow")) {
      return res.status(400).json({ error: "type must be instruction or example_flow" });
    }
    const entry = await stylingAgentConfig.upsertPlaybookEntry({ type, content, sortOrder, isActive });
    res.status(201).json(entry);
  })
);

/** PUT /api/admin/styling-playbook/:id - update playbook entry; body: { content?, sortOrder?, isActive? } */
router.put(
  "/styling-playbook/:id",
  asyncHandler(async (req, res) => {
    const { content, sortOrder, isActive } = req.body || {};
    const entry = await stylingAgentConfig.upsertPlaybookEntry({
      id: req.params.id,
      content,
      sortOrder,
      isActive,
    });
    res.json(entry);
  })
);

/** DELETE /api/admin/styling-playbook/:id */
router.delete(
  "/styling-playbook/:id",
  asyncHandler(async (req, res) => {
    await stylingAgentConfig.deletePlaybookEntry(req.params.id);
    res.status(204).send();
  })
);

// ---------- Look classification tags (for Look Analysis) ----------

/** GET /api/admin/look-classification-tags - list (query: limit?, offset?) */
router.get(
  "/look-classification-tags",
  asyncHandler(async (req, res) => {
    const { limit, offset } = req.query;
    const result = await lookClassificationTag.listLookClassificationTags({
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    res.json(result);
  })
);

/** POST /api/admin/look-classification-tags/seed - seed default tags if table empty */
router.post(
  "/look-classification-tags/seed",
  asyncHandler(async (req, res) => {
    const result = await lookClassificationTag.seedDefaultLookClassificationTags();
    res.json(result);
  })
);

/** POST /api/admin/look-classification-tags - create; body: { name, label?, description?, sortOrder? } */
router.post(
  "/look-classification-tags",
  asyncHandler(async (req, res) => {
    const { name, label, description, sortOrder } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    const created = await lookClassificationTag.createLookClassificationTag({
      name,
      label,
      description,
      sortOrder,
    });
    res.status(201).json(created);
  })
);

/** PUT /api/admin/look-classification-tags/:id - update; body: { name?, label?, description?, sortOrder? } */
router.put(
  "/look-classification-tags/:id",
  asyncHandler(async (req, res) => {
    const { name, label, description, sortOrder } = req.body || {};
    const updated = await lookClassificationTag.updateLookClassificationTag(req.params.id, {
      name,
      label,
      description,
      sortOrder,
    });
    if (!updated) return res.status(404).json({ error: "Tag not found" });
    res.json(updated);
  })
);

/** DELETE /api/admin/look-classification-tags/:id */
router.delete(
  "/look-classification-tags/:id",
  asyncHandler(async (req, res) => {
    const deleted = await lookClassificationTag.deleteLookClassificationTag(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Tag not found" });
    res.status(204).send();
  })
);

export default router;
