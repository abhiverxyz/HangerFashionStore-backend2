import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";

/**
 * Create a UserImage (generic user upload).
 * @param {Object} data - { userId, rawImageUrl, context? }
 */
export async function createUserImage(data) {
  const prisma = getPrisma();
  const userId = normalizeId(data.userId);
  if (!userId) throw new Error("userId required");
  return prisma.userImage.create({
    data: {
      userId,
      rawImageUrl: String(data.rawImageUrl),
      context: data.context ?? null,
    },
  });
}

/**
 * List user images for a user (optional).
 * @param {Object} opts - { userId?, limit?, offset? }
 */
export async function listUserImages(opts = {}) {
  const { userId, limit = 24, offset = 0 } = opts;
  const prisma = getPrisma();
  const where = {};
  if (normalizeId(userId)) where.userId = normalizeId(userId);

  const [items, total] = await Promise.all([
    prisma.userImage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(limit) || 24, 100),
      skip: Math.max(0, Number(offset) || 0),
    }),
    prisma.userImage.count({ where }),
  ]);
  return { items, total };
}
