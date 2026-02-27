import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";

/**
 * Create a wardrobe extraction row (pending).
 * @param {Object} data - { userId, lookId?, imageUrl, status?: 'pending' }
 */
export async function createWardrobeExtraction(data) {
  const prisma = getPrisma();
  const userId = normalizeId(data.userId);
  if (!userId) throw new Error("userId required");
  return prisma.wardrobeExtraction.create({
    data: {
      userId,
      lookId: data.lookId ?? null,
      imageUrl: String(data.imageUrl),
      status: data.status ?? "pending",
      slots: null,
      error: null,
    },
  });
}

/**
 * Update a wardrobe extraction (status, slots, error).
 */
export async function updateWardrobeExtraction(id, data) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  const allowed = ["status", "slots", "error"];
  const payload = {};
  for (const k of allowed) if (data[k] !== undefined) payload[k] = data[k];
  if (Object.keys(payload).length === 0) return getWardrobeExtraction(nid);
  if (payload.slots !== undefined && typeof payload.slots !== "string") {
    payload.slots = JSON.stringify(payload.slots);
  }
  return prisma.wardrobeExtraction.update({
    where: { id: nid },
    data: payload,
  });
}

/**
 * Get a single wardrobe extraction by id.
 */
export async function getWardrobeExtraction(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  return prisma.wardrobeExtraction.findUnique({ where: { id: nid } });
}

/**
 * Delete a wardrobe extraction by id. Returns true if deleted, false if not found.
 * Caller must ensure ownership (e.g. extraction.userId === req.userId).
 */
export async function deleteWardrobeExtraction(id) {
  const nid = normalizeId(id);
  if (!nid) return false;
  const prisma = getPrisma();
  const result = await prisma.wardrobeExtraction.deleteMany({ where: { id: nid } });
  return result.count > 0;
}

/**
 * List wardrobe extractions for a user (for "Extracted looks" carousel).
 * Slots are marked with added: true if user has already added that slot to wardrobe.
 * @param {Object} opts - { userId, status?: 'done', limit?, offset? }
 */
export async function listWardrobeExtractions(opts = {}) {
  const { userId, status, limit = 50, offset = 0 } = opts;
  const nid = normalizeId(userId);
  if (!nid) return { items: [], total: 0 };
  const prisma = getPrisma();
  const where = { userId: nid };
  if (status) where.status = String(status);

  const [rows, total, addedSlots] = await Promise.all([
    prisma.wardrobeExtraction.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: Math.min(Number(limit) || 50, 100),
      skip: Math.max(0, Number(offset) || 0),
    }),
    prisma.wardrobeExtraction.count({ where }),
    prisma.wardrobe.findMany({
      where: {
        userId: nid,
        extractionId: { not: null },
        extractionSlotIndex: { not: null },
      },
      select: { extractionId: true, extractionSlotIndex: true },
    }),
  ]);

  const addedSet = new Set(
    (addedSlots || []).map((w) => `${w.extractionId}:${w.extractionSlotIndex}`)
  );

  const items = rows.map((r) => {
    const slots = r.slots ? (typeof r.slots === "string" ? JSON.parse(r.slots) : r.slots) : [];
    const slotsWithAdded = slots.map((slot, i) => ({
      ...slot,
      added: addedSet.has(`${r.id}:${i}`),
    }));
    return { ...r, slots: slotsWithAdded };
  });

  return { items, total };
}
