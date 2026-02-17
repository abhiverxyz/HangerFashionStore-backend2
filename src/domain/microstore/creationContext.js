import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";

/**
 * List creation context entries (for admin). Optional filter by isActive.
 */
export async function listCreationContexts(opts = {}) {
  const { isActive, limit = 100, offset = 0 } = opts;
  const prisma = getPrisma();
  const where = {};
  if (typeof isActive === "boolean") where.isActive = isActive;

  const [items, total] = await Promise.all([
    prisma.microStoreCreationContext.findMany({
      where,
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      take: Math.min(Number(limit) || 100, 200),
      skip: Math.max(0, Number(offset) || 0),
    }),
    prisma.microStoreCreationContext.count({ where }),
  ]);
  return { items, total };
}

/**
 * Get active creation context entries for LLM prompt (reference titles/descriptions).
 * Ordered by order, then createdAt.
 */
export async function getActiveCreationContextsForLLM() {
  const prisma = getPrisma();
  return prisma.microStoreCreationContext.findMany({
    where: { isActive: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { title: true, description: true, vibe: true, category: true, trend: true, referenceImageUrl: true },
  });
}

/**
 * Get a single creation context by id.
 */
export async function getCreationContext(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  return prisma.microStoreCreationContext.findUnique({
    where: { id: nid },
  });
}

/**
 * Create a creation context entry.
 */
export async function createCreationContext(data) {
  const prisma = getPrisma();
  const { title, description, vibe, category, trend, referenceImageUrl, order, isActive = true } = data;
  return prisma.microStoreCreationContext.create({
    data: {
      title: title || "Untitled",
      description: description ?? null,
      vibe: vibe ?? null,
      category: category ?? null,
      trend: trend ?? null,
      referenceImageUrl: referenceImageUrl ?? null,
      order: Number(order) || 0,
      isActive: isActive !== false,
    },
  });
}

/**
 * Update a creation context entry.
 */
export async function updateCreationContext(id, data) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  const { title, description, vibe, category, trend, referenceImageUrl, order, isActive } = data;
  const update = {};
  if (title !== undefined) update.title = title;
  if (description !== undefined) update.description = description;
  if (vibe !== undefined) update.vibe = vibe;
  if (category !== undefined) update.category = category;
  if (trend !== undefined) update.trend = trend;
  if (referenceImageUrl !== undefined) update.referenceImageUrl = referenceImageUrl ?? null;
  if (order !== undefined) update.order = Number(order) ?? 0;
  if (typeof isActive === "boolean") update.isActive = isActive;
  return prisma.microStoreCreationContext.update({
    where: { id: nid },
    data: update,
  });
}

/**
 * Delete a creation context entry.
 */
export async function deleteCreationContext(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  return prisma.microStoreCreationContext.delete({
    where: { id: nid },
  });
}

/**
 * Reorder creation context entries. Pass array of { id, order }.
 */
export async function reorderCreationContexts(updates) {
  if (!Array.isArray(updates) || updates.length === 0) return;
  const prisma = getPrisma();
  await Promise.all(
    updates.map(({ id, order }) =>
      prisma.microStoreCreationContext.updateMany({
        where: { id: normalizeId(id) },
        data: { order: Number(order) ?? 0 },
      })
    )
  );
}
