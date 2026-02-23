import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";

function triggerPreferenceGraph(userId) {
  import("../preferences/preferenceGraph.js").then((m) => m.triggerBuildPreferenceGraph(userId)).catch(() => {});
}

const cartInclude = {
  product: {
    include: {
      brand: { select: { id: true, name: true, logoUrl: true } },
      images: { take: 1, orderBy: { position: "asc" } },
      variants: true,
    },
  },
};

/**
 * List cart items for a user.
 */
export async function listCartItems(userId) {
  const uid = normalizeId(userId);
  if (!uid) return { items: [] };
  const prisma = getPrisma();
  const items = await prisma.cartItem.findMany({
    where: { userId: uid },
    include: cartInclude,
    orderBy: { updatedAt: "desc" },
  });
  return { items };
}

/**
 * Add item to cart. Idempotent: if same productId+variantId exists, increment quantity.
 */
export async function addToCart(userId, productId, variantId = null, quantity = 1) {
  const uid = normalizeId(userId);
  const pid = normalizeId(productId);
  const vid = variantId != null && String(variantId).trim() !== "" ? String(variantId).trim() : null;
  if (!uid || !pid) return null;
  const prisma = getPrisma();
  const product = await prisma.product.findUnique({ where: { id: pid }, select: { id: true } });
  if (!product) return null;

  const existing = await prisma.cartItem.findFirst({
    where: { userId: uid, productId: pid, variantId: vid },
  });
  if (existing) {
    const updated = await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: existing.quantity + quantity, updatedAt: new Date() },
      include: cartInclude,
    });
  triggerPreferenceGraph(uid);
  return updated;
  }

  const created = await prisma.cartItem.create({
    data: { userId: uid, productId: pid, variantId: vid, quantity },
    include: cartInclude,
  });
  triggerPreferenceGraph(uid);
  return created;
}

/**
 * Remove from cart. If variantId omitted, remove the entry with variantId null for that product.
 */
export async function removeFromCart(userId, productId, variantId = null) {
  const uid = normalizeId(userId);
  const pid = normalizeId(productId);
  const vid = variantId != null && String(variantId).trim() !== "" ? String(variantId).trim() : null;
  if (!uid || !pid) return false;
  const prisma = getPrisma();
  const where = { userId: uid, productId: pid };
  if (vid !== null) where.variantId = vid;
  else where.variantId = null;
  const result = await prisma.cartItem.deleteMany({ where });
  if ((result?.count ?? 0) > 0) triggerPreferenceGraph(uid);
  return (result?.count ?? 0) > 0;
}

/**
 * Check if product (and optional variant) is in user's cart.
 */
export async function isInCart(userId, productId, variantId = null) {
  const uid = normalizeId(userId);
  const pid = normalizeId(productId);
  const vid = variantId != null && String(variantId).trim() !== "" ? String(variantId).trim() : null;
  if (!uid || !pid) return false;
  const prisma = getPrisma();
  const row = await prisma.cartItem.findFirst({
    where: { userId: uid, productId: pid, variantId: vid },
  });
  return Boolean(row);
}
