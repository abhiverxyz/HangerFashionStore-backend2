/**
 * Allowed microstore creators: users who can create microstores (in addition to admin/brand).
 */
import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";

/**
 * List all allowed creator user IDs (and optionally join user for display).
 */
export async function listAllowedMicrostoreCreators(opts = {}) {
  const { limit = 200, offset = 0 } = opts;
  const prisma = getPrisma();
  const items = await prisma.allowedMicrostoreCreator.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(limit) || 200, 500),
    skip: Math.max(0, Number(offset) || 0),
    include: {
      user: { select: { id: true, username: true, email: true, firstName: true, lastName: true } },
    },
  });
  const total = await prisma.allowedMicrostoreCreator.count();
  return { items, total };
}

/**
 * Add a user to the allowed creators list by userId.
 * @returns {Promise<{ id, userId } | null>}
 */
export async function addAllowedMicrostoreCreator(userId) {
  const uid = normalizeId(userId);
  if (!uid) return null;
  const prisma = getPrisma();
  const existing = await prisma.allowedMicrostoreCreator.findUnique({ where: { userId: uid } });
  if (existing) return existing;
  const row = await prisma.allowedMicrostoreCreator.create({
    data: { userId: uid },
  });
  return { id: row.id, userId: row.userId };
}

/**
 * Remove a user from the allowed creators list.
 */
export async function removeAllowedMicrostoreCreator(userId) {
  const uid = normalizeId(userId);
  if (!uid) return false;
  const prisma = getPrisma();
  await prisma.allowedMicrostoreCreator.deleteMany({ where: { userId: uid } });
  return true;
}

/**
 * Check whether the given user is allowed to create microstores.
 * Admin and brand roles are always allowed; others must be in the list.
 */
export async function canCreateMicrostore(userId, role) {
  const uid = normalizeId(userId);
  if (!uid) return false;
  if (role === "admin") return true;
  if (role === "brand") return true;
  const prisma = getPrisma();
  const row = await prisma.allowedMicrostoreCreator.findUnique({
    where: { userId: uid },
  });
  return Boolean(row);
}
