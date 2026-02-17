/**
 * Admin: brands, sync-status, enrich, products delete, brand-users.
 */
import { Router } from "express";
import { asyncHandler } from "../../core/asyncHandler.js";
import { getPrisma } from "../../core/db.js";
import {
  getEnrichmentQueueStats,
  getEnrichmentJobStatus,
  enqueueEnrichment,
  enqueueSyncShopify,
} from "../../utils/queue.js";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const router = Router();
const BRAND_USER_ID_PREFIX = "brand_";
function generateBrandUserId() {
  return BRAND_USER_ID_PREFIX + randomUUID().replace(/-/g, "").slice(0, 24);
}

router.get(
  "/brands",
  asyncHandler(async (req, res) => {
    const prisma = getPrisma();
    const brands = await prisma.brand.findMany({
      select: { id: true, name: true, shopDomain: true, isActive: true },
      orderBy: { name: "asc" },
    });
    res.json({ items: brands });
  })
);

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

router.get(
  "/enrich-status/:productId",
  asyncHandler(async (req, res) => {
    const status = await getEnrichmentJobStatus(req.params.productId);
    res.json(status);
  })
);

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

router.post(
  "/brand-users",
  asyncHandler(async (req, res) => {
    const { brandId, username, password } = req.body || {};
    const bid = (brandId || "").trim();
    const uname = (username || "").trim();
    const pwd = typeof password === "string" ? password : "";
    if (!bid || !uname || !pwd) {
      return res.status(400).json({ error: "brandId, username, and password are required" });
    }
    const prisma = getPrisma();
    const brand = await prisma.brand.findUnique({ where: { id: bid }, select: { id: true } });
    if (!brand) return res.status(404).json({ error: "Brand not found" });
    const existing = await prisma.user.findUnique({
      where: { username: uname },
      select: { id: true },
    });
    if (existing) return res.status(409).json({ error: "Username already in use" });
    const userId = generateBrandUserId();
    const passwordHash = await bcrypt.hash(pwd, 10);
    const email = `${uname}@brand-placeholder.local`;
    await prisma.user.create({
      data: {
        id: userId,
        username: uname,
        email,
        passwordHash,
        role: "brand",
        isActive: true,
      },
    });
    await prisma.brandAdmin.create({
      data: { userId, brandId: bid },
    });
    res.status(201).json({
      id: userId,
      username: uname,
      role: "brand",
      brandId: bid,
      message: "Brand user created; they can log in with this username and password.",
    });
  })
);

router.get(
  "/brand-users",
  asyncHandler(async (req, res) => {
    const prisma = getPrisma();
    const users = await prisma.user.findMany({
      where: { role: "brand", isActive: true },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        createdAt: true,
        brandAdmins: { select: { brandId: true }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    });
    const brandIds = [...new Set(users.flatMap((u) => u.brandAdmins.map((a) => a.brandId)))];
    const brands = brandIds.length
      ? await prisma.brand.findMany({
          where: { id: { in: brandIds } },
          select: { id: true, name: true, shopDomain: true },
        })
      : [];
    const brandMap = Object.fromEntries(brands.map((b) => [b.id, b]));
    const items = users.map((u) => ({
      id: u.id,
      email: u.email ?? undefined,
      username: u.username ?? undefined,
      role: u.role,
      createdAt: u.createdAt,
      brandId: u.brandAdmins[0]?.brandId ?? null,
      brand: u.brandAdmins[0] ? brandMap[u.brandAdmins[0].brandId] ?? null : null,
    }));
    res.json({ items });
  })
);

export default router;
