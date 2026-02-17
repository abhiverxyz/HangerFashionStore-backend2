import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";

export async function listLooks(opts = {}) {
  const { userId, limit = 24, offset = 0 } = opts;
  const prisma = getPrisma();
  const where = {};
  if (normalizeId(userId)) where.userId = normalizeId(userId);

  const [items, total] = await Promise.all([
    prisma.look.findMany({
      where,
      include: { images: true },
      orderBy: { updatedAt: "desc" },
      take: Math.min(Number(limit) || 24, 100),
      skip: Math.max(0, Number(offset) || 0),
    }),
    prisma.look.count({ where }),
  ]);
  return { items, total };
}

/**
 * List last N looks for a user with parsed lookData (for Style Report Agent).
 * Each item has lookDataParsed: { comment, vibe, occasion, timeOfDay, labels, itemsSummary, analysisComment, suggestions, classificationTags }.
 * @param {string} userId
 * @param {number} [limit=15]
 * @returns {Promise<{ items: Array<Look & { lookDataParsed: object }>, total: number }>}
 */
export async function listLooksForStyleReport(userId, limit = 15) {
  const uid = normalizeId(userId);
  if (!uid) return { items: [], total: 0 };
  const { items, total } = await listLooks({ userId: uid, limit: Math.min(Number(limit) || 15, 20), offset: 0 });
  const withParsed = items.map((look) => {
    let lookDataParsed = {};
    try {
      lookDataParsed = typeof look.lookData === "string" ? JSON.parse(look.lookData) : look.lookData || {};
    } catch {
      lookDataParsed = {};
    }
    return { ...look, lookDataParsed };
  });
  return { items: withParsed, total };
}

export async function getLook(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  return prisma.look.findUnique({
    where: { id: nid },
    include: { images: true },
  });
}

export async function createLook(data) {
  const prisma = getPrisma();
  const payload = {
    lookData: String(data.lookData ?? "{}"),
    imageUrl: data.imageUrl ?? null,
    vibe: data.vibe ?? null,
    occasion: data.occasion ?? null,
  };
  if (data.userId) payload.userId = data.userId;
  return prisma.look.create({ data: payload });
}

export async function updateLook(id, data) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  const allowed = ["lookData", "imageUrl", "vibe", "occasion"];
  const payload = {};
  for (const k of allowed) if (data[k] !== undefined) payload[k] = data[k];
  if (Object.keys(payload).length === 0) return getLook(nid);
  return prisma.look.update({
    where: { id: nid },
    data: payload,
    include: { images: true },
  });
}

export async function deleteLook(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  return prisma.look.delete({ where: { id: nid } }).catch(() => null);
}
