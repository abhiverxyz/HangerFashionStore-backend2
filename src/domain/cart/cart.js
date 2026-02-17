import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";

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
