import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";

const wishlistInclude = {
  product: {
    include: {
      brand: { select: { id: true, name: true, logoUrl: true } },
      images: { take: 1, orderBy: { position: "asc" } },
      variants: true,
    },
  },
};

/**
 * List wishlist items for a user.
 */
export async function listWishlist(userId) {
  const uid = normalizeId(userId);
  if (!uid) return { items: [] };
  const prisma = getPrisma();
  const items = await prisma.wishlist.findMany({
    where: { userId: uid },
    include: wishlistInclude,
    orderBy: { createdAt: "desc" },
  });
  return { items };
}

/**
 * Add product to wishlist. Idempotent (upsert).
 */
export async function addToWishlist(userId, productId, variantId = null) {
  const uid = normalizeId(userId);
  const pid = normalizeId(productId);
  const vid = variantId != null && String(variantId).trim() !== "" ? String(variantId).trim() : null;
  if (!uid || !pid) return null;
  const prisma = getPrisma();
  const product = await prisma.product.findUnique({ where: { id: pid }, select: { id: true } });
  if (!product) return null;

  const existing = await prisma.wishlist.findFirst({
    where: { userId: uid, productId: pid, variantId: vid },
  });
  if (existing) {
    return prisma.wishlist.findUnique({
      where: { id: existing.id },
      include: wishlistInclude,
    });
  }

  const created = await prisma.wishlist.create({
    data: { userId: uid, productId: pid, variantId: vid },
    include: wishlistInclude,
  });
  return created;
}

/**
 * Remove from wishlist. If variantId omitted, remove the entry with variantId null for that product.
 */
export async function removeFromWishlist(userId, productId, variantId = null) {
  const uid = normalizeId(userId);
  const pid = normalizeId(productId);
  const vid = variantId != null && String(variantId).trim() !== "" ? String(variantId).trim() : null;
  if (!uid || !pid) return false;
  const prisma = getPrisma();
  const where = { userId: uid, productId: pid };
  if (vid !== null) where.variantId = vid;
  else where.variantId = null;
  const result = await prisma.wishlist.deleteMany({ where });
  return (result?.count ?? 0) > 0;
}

/**
 * Check if product (and optional variant) is in user's wishlist.
 */
export async function isInWishlist(userId, productId, variantId = null) {
  const uid = normalizeId(userId);
  const pid = normalizeId(productId);
  const vid = variantId != null && String(variantId).trim() !== "" ? String(variantId).trim() : null;
  if (!uid || !pid) return false;
  const prisma = getPrisma();
  const row = await prisma.wishlist.findFirst({
    where: { userId: uid, productId: pid, variantId: vid },
  });
  return Boolean(row);
}
