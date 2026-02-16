/**
 * Look classification tags: admin-managed tags for classifying user looks.
 * Used by Look Analysis for classification; defaults seeded when empty.
 */

import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";

const DEFAULT_TAGS = [
  { name: "casual", label: "Casual", description: "Everyday, relaxed looks", sortOrder: 1 },
  { name: "formal", label: "Formal", description: "Business, black-tie, events", sortOrder: 2 },
  { name: "work", label: "Work", description: "Office and professional", sortOrder: 3 },
  { name: "weekend", label: "Weekend", description: "Off-duty, brunch, errands", sortOrder: 4 },
  { name: "party", label: "Party", description: "Nights out, celebrations", sortOrder: 5 },
  { name: "vacation", label: "Vacation", description: "Travel, holiday vibes", sortOrder: 6 },
  { name: "date-night", label: "Date Night", description: "Romantic or special evening", sortOrder: 7 },
  { name: "streetwear", label: "Streetwear", description: "Urban, street style", sortOrder: 8 },
  { name: "minimal", label: "Minimal", description: "Clean, understated", sortOrder: 9 },
  { name: "bold", label: "Bold", description: "Statement, high impact", sortOrder: 10 },
  { name: "sporty", label: "Sporty", description: "Active, athleisure", sortOrder: 11 },
  { name: "elegant", label: "Elegant", description: "Refined, polished", sortOrder: 12 },
  { name: "cozy", label: "Cozy", description: "Comfortable, relaxed", sortOrder: 13 },
  { name: "edgy", label: "Edgy", description: "Alternative, rebellious", sortOrder: 14 },
  { name: "classic", label: "Classic", description: "Timeless, traditional", sortOrder: 15 },
  { name: "trendy", label: "Trendy", description: "Current season trends", sortOrder: 16 },
  { name: "bohemian", label: "Bohemian", description: "Free-spirited, boho", sortOrder: 17 },
  { name: "preppy", label: "Preppy", description: "Polished, collegiate", sortOrder: 18 },
  { name: "athleisure", label: "Athleisure", description: "Sport-meets-casual", sortOrder: 19 },
  { name: "smart-casual", label: "Smart Casual", description: "Polished but relaxed", sortOrder: 20 },
];

/**
 * List all look classification tags, ordered by sortOrder then name.
 * @param {Object} opts - { limit?, offset? }
 */
export async function listLookClassificationTags(opts = {}) {
  const prisma = getPrisma();
  const limit = Math.min(Number(opts.limit) || 100, 200);
  const offset = Math.max(0, Number(opts.offset) || 0);
  const [items, total] = await Promise.all([
    prisma.lookClassificationTag.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: limit,
      skip: offset,
    }),
    prisma.lookClassificationTag.count(),
  ]);
  return { items, total, limit, offset };
}

/**
 * Get a single tag by id.
 */
export async function getLookClassificationTag(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  return prisma.lookClassificationTag.findUnique({
    where: { id: nid },
  });
}

/**
 * Create a look classification tag. name must be unique.
 */
export async function createLookClassificationTag(data) {
  const prisma = getPrisma();
  const name = String(data.name ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  const label = String(data.label ?? name).trim();
  if (!name) throw new Error("name is required");
  const existing = await prisma.lookClassificationTag.findUnique({ where: { name } });
  if (existing) throw new Error("A tag with this name already exists");
  return prisma.lookClassificationTag.create({
    data: {
      name,
      label: label || name,
      description: data.description != null ? String(data.description).trim() || null : null,
      sortOrder: Number(data.sortOrder) ?? 0,
    },
  });
}

/**
 * Update a look classification tag by id.
 */
export async function updateLookClassificationTag(id, data) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  const existing = await prisma.lookClassificationTag.findUnique({ where: { id: nid } });
  if (!existing) return null;
  const payload = {};
  if (data.label !== undefined) payload.label = String(data.label).trim() || existing.label;
  if (data.description !== undefined) payload.description = data.description == null ? null : String(data.description).trim();
  if (data.sortOrder !== undefined) payload.sortOrder = Number(data.sortOrder);
  if (data.name !== undefined) {
    const name = String(data.name).trim().toLowerCase().replace(/\s+/g, "-");
    if (name && name !== existing.name) {
      const conflict = await prisma.lookClassificationTag.findUnique({ where: { name } });
      if (conflict) throw new Error("A tag with this name already exists");
      payload.name = name;
    }
  }
  if (Object.keys(payload).length === 0) return existing;
  return prisma.lookClassificationTag.update({
    where: { id: nid },
    data: payload,
  });
}

/**
 * Delete a look classification tag by id.
 */
export async function deleteLookClassificationTag(id) {
  const nid = normalizeId(id);
  if (!nid) return null;
  const prisma = getPrisma();
  return prisma.lookClassificationTag.delete({ where: { id: nid } }).catch(() => null);
}

/**
 * Seed default look classification tags only if the table is empty.
 * Returns { seeded: number } (0 if already had tags).
 */
export async function seedDefaultLookClassificationTags() {
  const prisma = getPrisma();
  const count = await prisma.lookClassificationTag.count();
  if (count > 0) return { seeded: 0 };
  for (const tag of DEFAULT_TAGS) {
    await prisma.lookClassificationTag.create({
      data: {
        name: tag.name,
        label: tag.label,
        description: tag.description ?? null,
        sortOrder: tag.sortOrder,
      },
    });
  }
  return { seeded: DEFAULT_TAGS.length };
}
