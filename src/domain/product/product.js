import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";

/**
 * Get a single product by id (with brand and images).
 */
export async function getProduct(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  return prisma.product.findUnique({
    where: { id: nid },
    include: {
      brand: { select: { id: true, name: true, logoUrl: true } },
      images: { orderBy: { position: "asc" } },
      variants: true,
    },
  });
}

/**
 * List products with optional filters and optional text search (title, tags).
 * @param {Object} opts - { brandId?, status?, limit?, offset?, category_lvl1?, occasion_primary?, mood_vibe?, search? }
 */
export async function listProducts(opts = {}) {
  const {
    brandId,
    status = "active",
    limit = 24,
    offset = 0,
    category_lvl1,
    occasion_primary,
    mood_vibe,
    search,
  } = opts;
  const prisma = getPrisma();
  const where = { status: status || "active" };
  if (normalizeId(brandId)) where.brandId = normalizeId(brandId);
  if (category_lvl1 != null && String(category_lvl1).trim()) where.category_lvl1 = String(category_lvl1).trim();
  if (occasion_primary != null && String(occasion_primary).trim()) where.occasion_primary = String(occasion_primary).trim();
  if (mood_vibe != null && String(mood_vibe).trim()) where.mood_vibe = String(mood_vibe).trim();
  if (search != null && String(search).trim()) {
    const q = `%${String(search).trim()}%`;
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { tags: { contains: q, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        brand: { select: { id: true, name: true, logoUrl: true } },
        images: { take: 1, orderBy: { position: "asc" } },
      },
      orderBy: { updatedAt: "desc" },
      take: Math.min(Number(limit) || 24, 100),
      skip: Math.max(0, Number(offset) || 0),
    }),
    prisma.product.count({ where }),
  ]);

  return { items, total };
}
