/**
 * Generated Image store: cache for AI-generated look and microstore cover images.
 * Search before generate; save after generate so we can reuse by vibe/occasion or name/vibe.
 */

import { getPrisma } from "../core/db.js";
import { urlToStorageKey } from "../utils/storage.js";

const SOURCE_LOOK = "look";
const SOURCE_MICROSTORE_COVER = "microstore_cover";

/**
 * Create a generated image record.
 * @param {Object} data
 * @param {string} data.sourceType - "look" | "microstore_cover"
 * @param {string} data.imageUrl - Full storage URL
 * @param {string} [data.storageKey] - Optional; derived from imageUrl if not set
 * @param {string} [data.vibe]
 * @param {string} [data.occasion]
 * @param {string} [data.ideaDescription]
 * @param {string} [data.name]
 * @param {string} [data.description]
 * @param {string} [data.categories]
 * @param {string} [data.trends]
 * @param {string} [data.lookData] - JSON string
 * @param {string} [data.imageStyle] - "flat_lay" | "on_model"
 * @returns {Promise<{ id: string, imageUrl: string, ... }>}
 */
export async function createGeneratedImage(data) {
  const prisma = getPrisma();
  const storageKey = data.storageKey ?? (data.imageUrl ? urlToStorageKey(data.imageUrl) : null);
  const payload = {
    sourceType: String(data.sourceType).trim(),
    imageUrl: String(data.imageUrl).trim(),
    storageKey: storageKey ?? undefined,
    vibe: data.vibe != null ? String(data.vibe).trim() || undefined : undefined,
    occasion: data.occasion != null ? String(data.occasion).trim() || undefined : undefined,
    ideaDescription:
      data.ideaDescription != null ? String(data.ideaDescription).trim().slice(0, 500) || undefined : undefined,
    name: data.name != null ? String(data.name).trim().slice(0, 200) || undefined : undefined,
    description: data.description != null ? String(data.description).trim().slice(0, 1000) || undefined : undefined,
    categories: data.categories != null ? String(data.categories).trim().slice(0, 500) || undefined : undefined,
    trends: data.trends != null ? String(data.trends).trim().slice(0, 500) || undefined : undefined,
    lookData: data.lookData != null ? String(data.lookData).slice(0, 5000) || undefined : undefined,
    imageStyle: data.imageStyle != null ? String(data.imageStyle).trim() || undefined : undefined,
  };
  if (!payload.sourceType || !payload.imageUrl) {
    throw new Error("sourceType and imageUrl are required");
  }
  return prisma.cachedGeneratedImage.create({ data: payload });
}

/**
 * Find a cached generated image by criteria. Returns the most recent match.
 * @param {Object} opts
 * @param {string} opts.sourceType - "look" | "microstore_cover"
 * @param {string} [opts.vibe]
 * @param {string} [opts.occasion]
 * @param {string} [opts.imageStyle] - "flat_lay" | "on_model"
 * @param {string} [opts.ideaDescription] - For look: when set, match this idea; when omitted (e.g. look planning), match rows with no ideaDescription
 * @param {string} [opts.name] - For microstore_cover
 * @param {string} [opts.description]
 * @param {string} [opts.categories]
 * @param {string} [opts.trends]
 * @param {number} [opts.limit=1]
 * @returns {Promise<Array<{ id: string, imageUrl: string, ... }>>}
 */
export async function findGeneratedImage(opts = {}) {
  const prisma = getPrisma();
  const sourceType = opts.sourceType && String(opts.sourceType).trim();
  if (!sourceType) return [];

  const limit = Math.min(Math.max(1, Number(opts.limit) || 1), 20);

  if (sourceType === SOURCE_LOOK) {
    const vibe = opts.vibe != null ? String(opts.vibe).trim() || null : null;
    const occasion = opts.occasion != null ? String(opts.occasion).trim() || null : null;
    const imageStyle = opts.imageStyle && String(opts.imageStyle).trim() ? String(opts.imageStyle).trim() : null;
    const ideaDescription =
      opts.ideaDescription != null && String(opts.ideaDescription).trim()
        ? String(opts.ideaDescription).trim().slice(0, 500)
        : null;

    const where = { sourceType: SOURCE_LOOK };
    if (vibe) where.vibe = vibe;
    if (occasion) where.occasion = occasion;
    if (imageStyle) where.imageStyle = imageStyle;
    if (ideaDescription) {
      where.ideaDescription = ideaDescription;
    } else {
      where.OR = [{ ideaDescription: null }, { ideaDescription: "" }];
    }

    return prisma.cachedGeneratedImage.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
  }

  if (sourceType === SOURCE_MICROSTORE_COVER) {
    const name = opts.name != null ? String(opts.name).trim().slice(0, 200) : null;
    const vibe = opts.vibe != null ? String(opts.vibe).trim() || null : null;

    const where = { sourceType: SOURCE_MICROSTORE_COVER };
    if (name) where.name = name;
    if (vibe) where.vibe = vibe;

    return prisma.cachedGeneratedImage.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
  }

  return [];
}

/**
 * Get one cached image by criteria (convenience). Returns first from findGeneratedImage or null.
 * @param {Object} opts - Same as findGeneratedImage
 * @returns {Promise<{ id: string, imageUrl: string, ... } | null>}
 */
export async function getOneGeneratedImage(opts) {
  const list = await findGeneratedImage({ ...opts, limit: 1 });
  return list.length > 0 ? list[0] : null;
}

/**
 * Get by id.
 * @param {string} id
 * @returns {Promise<{ id: string, imageUrl: string, ... } | null>}
 */
export async function getGeneratedImage(id) {
  if (!id || typeof id !== "string") return null;
  const prisma = getPrisma();
  return prisma.cachedGeneratedImage.findUnique({ where: { id: id.trim() } });
}

export { SOURCE_LOOK, SOURCE_MICROSTORE_COVER };
