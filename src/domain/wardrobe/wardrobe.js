import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";
import { getProduct } from "../product/product.js";

/**
 * List wardrobe items for a user.
 * @param {Object} opts - { userId, limit?, offset?, category?, excludeSource? } — excludeSource e.g. 'look' hides full look images from grid
 */
export async function listWardrobe(opts = {}) {
  const { userId, limit = 48, offset = 0, category, excludeSource } = opts;
  const nid = normalizeId(userId);
  if (!nid) return { items: [], total: 0 };
  const prisma = getPrisma();
  const where = { userId: nid };
  if (category) where.category = String(category);
  if (excludeSource) {
    where.OR = [{ source: null }, { source: { not: excludeSource } }];
  }

  const [items, total] = await Promise.all([
    prisma.wardrobe.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: Math.min(Number(limit) || 48, 100),
      skip: Math.max(0, Number(offset) || 0),
    }),
    prisma.wardrobe.count({ where }),
  ]);
  return { items, total };
}

/**
 * Get a single wardrobe item by id.
 */
export async function getWardrobeItem(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  return prisma.wardrobe.findUnique({ where: { id: nid } });
}

/**
 * Create a wardrobe item (e.g. after upload or from extracted slot).
 * @param {Object} data - { userId, imageUrl, brand?, category?, color?, colorHex?, colorBrightness?, colorSaturation?, colorIsNeutral?, size?, tags?, source?, extractionId?, extractionSlotIndex? }
 */
export async function createWardrobeItem(data) {
  const prisma = getPrisma();
  const userId = normalizeId(data.userId);
  if (!userId) throw new Error("userId required");
  return prisma.wardrobe.create({
    data: {
      userId,
      imageUrl: String(data.imageUrl),
      brand: data.brand ?? null,
      category: data.category ?? null,
      color: data.color ?? null,
      colorHex: data.colorHex ?? null,
      colorBrightness: data.colorBrightness ?? null,
      colorSaturation: data.colorSaturation ?? null,
      colorSaturationPercent: data.colorSaturationPercent ?? null,
      colorLightnessPercent: data.colorLightnessPercent ?? null,
      colorIsNeutral: data.colorIsNeutral ?? null,
      size: data.size ?? null,
      tags: data.tags ?? null,
      source: data.source ?? null,
      extractionId: data.extractionId ?? null,
      extractionSlotIndex: data.extractionSlotIndex != null ? Number(data.extractionSlotIndex) : null,
    },
  });
}

/**
 * Update a wardrobe item (partial).
 */
export async function updateWardrobeItem(id, data) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  const allowed = [
    "imageUrl",
    "brand",
    "category",
    "color",
    "colorHex",
    "colorBrightness",
    "colorSaturation",
    "colorSaturationPercent",
    "colorLightnessPercent",
    "colorIsNeutral",
    "size",
    "tags",
  ];
  const payload = {};
  for (const k of allowed) if (data[k] !== undefined) payload[k] = data[k];
  if (Object.keys(payload).length === 0) return getWardrobeItem(nid);
  return prisma.wardrobe.update({ where: { id: nid }, data: payload });
}

/**
 * Delete a wardrobe item.
 */
export async function deleteWardrobeItem(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  return prisma.wardrobe.delete({ where: { id: nid } }).catch(() => null);
}

/**
 * Create wardrobe items from selected product IDs (B4.6 accept-suggestions).
 * @param {Object} opts - { userId, productIds, extractionId?, extractionSlotIndex? }
 */
export async function createWardrobeItemsFromProducts(opts) {
  const { userId, productIds, extractionId, extractionSlotIndex } = opts ?? {};
  const uid = normalizeId(userId);
  if (!uid) throw new Error("userId required");
  const ids = Array.isArray(productIds) ? productIds.filter((id) => normalizeId(id)) : [];
  if (ids.length === 0) return { created: [] };

  const created = [];
  for (const productId of ids) {
    const product = await getProduct(productId);
    if (!product) continue;
    const imageUrl = product.images?.[0]?.src ?? null;
    if (!imageUrl) continue;
    const item = await createWardrobeItem({
      userId: uid,
      imageUrl,
      brand: product.brand?.name ?? null,
      category: product.category_lvl1 ?? null,
      color: product.color_primary ?? null,
      size: null,
      tags: product.title ?? null,
      source: extractionId != null ? "extraction" : null,
      extractionId: extractionId ?? null,
      extractionSlotIndex: extractionSlotIndex != null ? Number(extractionSlotIndex) : null,
    });
    created.push(item);
  }
  return { created };
}
