import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";

const defaultInclude = {
  _count: { select: { followers: true, products: true } },
};

/**
 * List brands (active by default). Simple order by name; B5 personalization can plug in later.
 */
export async function listBrands(opts = {}) {
  const { limit = 24, offset = 0, search, isActive = true } = opts;
  const prisma = getPrisma();
  const where = {};
  if (typeof isActive === "boolean") where.isActive = isActive;
  if (search != null && String(search).trim()) {
    const q = `%${String(search).trim()}%`;
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.brand.findMany({
      where,
      include: defaultInclude,
      orderBy: { name: "asc" },
      take: Math.min(Number(limit) || 24, 100),
      skip: Math.max(0, Number(offset) || 0),
    }),
    prisma.brand.count({ where }),
  ]);

  return { items, total };
}

/**
 * Get a single brand by id.
 */
export async function getBrand(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  return prisma.brand.findUnique({
    where: { id: nid },
    include: defaultInclude,
  });
}

/**
 * Follow a brand.
 */
export async function followBrand(brandId, userId) {
  const bid = normalizeId(brandId);
  const uid = normalizeId(userId);
  if (!bid || !uid) return null;
  const prisma = getPrisma();
  await prisma.brandFollower.upsert({
    where: { brandId_userId: { brandId: bid, userId: uid } },
    create: { brandId: bid, userId: uid },
    update: {},
  });
  return getBrand(bid);
}

/**
 * Unfollow a brand.
 */
export async function unfollowBrand(brandId, userId) {
  const bid = normalizeId(brandId);
  const uid = normalizeId(userId);
  if (!bid || !uid) return null;
  const prisma = getPrisma();
  await prisma.brandFollower.deleteMany({ where: { brandId: bid, userId: uid } });
  return getBrand(bid);
}

/**
 * Check if user follows a brand.
 */
export async function isFollowingBrand(brandId, userId) {
  const bid = normalizeId(brandId);
  const uid = normalizeId(userId);
  if (!bid || !uid) return false;
  const prisma = getPrisma();
  const row = await prisma.brandFollower.findUnique({
    where: { brandId_userId: { brandId: bid, userId: uid } },
  });
  return Boolean(row);
}

/**
 * Search brands by name/description (text).
 */
export async function searchBrands(query, opts = {}) {
  const { limit = 20 } = opts;
  const q = typeof query === "string" ? query.trim() : "";
  const prisma = getPrisma();
  const where = { isActive: true };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }
  const items = await prisma.brand.findMany({
    where,
    include: defaultInclude,
    orderBy: { name: "asc" },
    take: Math.min(Number(limit) || 20, 50),
  });
  return { items };
}

/**
 * Update brand (for brand zone edit by brand user or admin).
 */
export async function updateBrand(id, data) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  const { name, description, logoUrl, websiteUrl, pageConfig, ...rest } = data;
  const update = { ...rest };
  if (name !== undefined) update.name = name;
  if (description !== undefined) update.description = description;
  if (logoUrl !== undefined) update.logoUrl = logoUrl;
  if (websiteUrl !== undefined) update.websiteUrl = websiteUrl;
  if (pageConfig !== undefined) update.pageConfig = typeof pageConfig === "string" ? pageConfig : JSON.stringify(pageConfig);

  return prisma.brand.update({
    where: { id: nid },
    data: update,
    include: defaultInclude,
  });
}
