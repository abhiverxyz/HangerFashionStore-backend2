/**
 * B4.5 Wardrobe Extraction Agent
 * Input: look (image URL or look id). Uses image analysis to extract items, then product search
 * "closest items" (semantic/text) to suggest product IDs per slot. Returns suggestions; accept writes to Wardrobe API.
 */

import { analyzeImage } from "../utils/imageAnalysis.js";
import { complete } from "../utils/llm.js";
import { searchProducts } from "../domain/product/product.js";
import { getLook } from "../domain/looks/look.js";

/** Number of product suggestions per extracted item. */
const SUGGESTIONS_PER_SLOT = 5;
const VALIDATE_MATCH_MAX_TOKENS = 150;

/**
 * Build a search query string from an extracted item (description + category + color).
 * @param {Object} item - Item from vision: { description?, category_lvl1?, color_primary?, type? }
 * @returns {string}
 */
export function itemToSearchQuery(item) {
  const parts = [];
  if (item.description && String(item.description).trim()) parts.push(String(item.description).trim());
  if (item.category_lvl1 && String(item.category_lvl1).trim()) parts.push(String(item.category_lvl1).trim());
  if (item.color_primary && String(item.color_primary).trim()) parts.push(String(item.color_primary).trim());
  if (item.type && String(item.type).trim() && !parts.length) parts.push(String(item.type).trim());
  return parts.length ? parts.join(" ") : "clothing";
}

/**
 * Validate which suggested products match the extracted item. Returns indices to keep.
 * @param {Object} item - Extracted item: { type?, description?, category_lvl1?, color_primary? }
 * @param {Object[]} suggestedProducts - Array of { productId, title, imageUrl?, category?, brand? }
 * @returns {Promise<{ goodIndices: number[] } | null>}
 */
async function validateSlotMatchQuality(item, suggestedProducts) {
  if (!suggestedProducts || suggestedProducts.length === 0) return null;
  try {
    const list = suggestedProducts.slice(0, SUGGESTIONS_PER_SLOT).map((p, idx) => ({
      index: idx,
      title: (p.title || "").slice(0, 80),
      category: (p.category || "").slice(0, 40),
    }));
    const prompt = `You are a match quality checker for fashion items.

Extracted item from a look image:
- type: ${(item?.type || "").slice(0, 40)}
- description: ${(item?.description || "").slice(0, 150)}
- category: ${(item?.category_lvl1 || "").slice(0, 40)}
- color: ${(item?.color_primary || "").slice(0, 40)}

Suggested products (index, title, category):
${JSON.stringify(list)}

Which of these products are a good match for this extracted item? Reply with JSON only: { "goodIndices": number[] } — array of 0-based indices of suggestions that fit. Omit indices that are poor matches. If none fit well, return empty array.`;

    const out = await complete(
      [
        { role: "system", content: "You output only valid JSON. No markdown or preamble." },
        { role: "user", content: prompt },
      ],
      { responseFormat: "json_object", maxTokens: VALIDATE_MATCH_MAX_TOKENS }
    );
    if (out && typeof out === "object" && Array.isArray(out.goodIndices)) {
      const len = suggestedProducts.length;
      const goodIndices = [...new Set(out.goodIndices)]
        .filter((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < len)
        .sort((a, b) => a - b);
      return { goodIndices };
    }
  } catch (e) {
    console.warn("[wardrobeExtractionAgent] validateSlotMatchQuality failed:", e?.message);
  }
  return null;
}

/**
 * Get product suggestions for a single item descriptor (for "resuggest" one slot).
 * @param {Object} item - { description?, category_lvl1?, color_primary?, type? }
 * @param {number} [limit=5]
 * @returns {Promise<{ suggestedProducts: Array<{ productId, title, imageUrl, category, brand }> }>}
 */
export async function suggestForItem(item, limit = 5) {
  const query = itemToSearchQuery(item || {});
  const searchResult = await searchProducts({
    query,
    category_lvl1: item?.category_lvl1 || undefined,
    limit: Math.min(Number(limit) || 5, 20),
    offset: 0,
  });
  let suggestedProducts = (searchResult?.items || []).map((p) => ({
    productId: p.id,
    title: p.title,
    imageUrl: p.images?.[0]?.src ?? null,
    category: p.category_lvl1 ?? null,
    brand: p.brand?.name ?? null,
  }));
  const validation = await validateSlotMatchQuality(item || {}, suggestedProducts);
  if (validation && Array.isArray(validation.goodIndices)) {
    if (validation.goodIndices.length === 0) {
      suggestedProducts = [];
    } else {
      suggestedProducts = validation.goodIndices.map((idx) => suggestedProducts[idx]).filter(Boolean);
    }
  }
  return { suggestedProducts };
}

/**
 * Run Wardrobe Extraction Agent.
 * @param {Object} input - { lookId?: string, imageUrl?: string, imageBuffer?: Buffer, contentType?: string }
 * @param {Object} context - { userId: string } (optional; for ownership check when lookId is provided)
 * @returns {Promise<{ slots: Array<{ itemIndex: number, item: object, suggestedProducts: object[] }>, look?: object, error?: string }>}
 */
export async function run(input, context = {}) {
  const { lookId, imageUrl, imageBuffer, contentType } = input || {};
  const userId = context?.userId;

  let imageForAnalysis = imageUrl;
  if (lookId) {
    const look = await getLook(lookId);
    if (!look) {
      return { slots: [], error: "Look not found" };
    }
    if (userId && look.userId && look.userId !== userId) {
      return { slots: [], error: "Forbidden: you can only extract from your own look" };
    }
    imageForAnalysis = look.imageUrl;
  }

  if (imageBuffer && Buffer.isBuffer(imageBuffer)) {
    imageForAnalysis = imageBuffer;
  }

  if (!imageForAnalysis) {
    return { slots: [], error: "Provide lookId, imageUrl, or imageBuffer" };
  }

  let analysis;
  try {
    analysis = await analyzeImage(imageForAnalysis, { responseFormat: "json_object" });
  } catch (err) {
    console.warn("[wardrobeExtractionAgent] Image analysis failed:", err?.message);
    return { slots: [], error: "Image analysis failed: " + (err?.message || "unknown error") };
  }

  const items = Array.isArray(analysis?.items) ? analysis.items : [];
  if (items.length === 0) {
    return {
      slots: [],
      look: analysis?.look ?? null,
      error: "No items detected in the image",
    };
  }

  // Run product search for all slots in parallel for lower latency
  const searchPromises = items.map((item) =>
    searchProducts({
      query: itemToSearchQuery(item),
      category_lvl1: item.category_lvl1 || undefined,
      limit: SUGGESTIONS_PER_SLOT,
      offset: 0,
    })
  );
  const searchResults = await Promise.allSettled(searchPromises);

  let slots = items.map((item, i) => {
    const result = searchResults[i];
    let suggestedProducts = [];
    if (result.status === "fulfilled" && result.value?.items) {
      suggestedProducts = result.value.items.map((p) => ({
        productId: p.id,
        title: p.title,
        imageUrl: p.images?.[0]?.src ?? null,
        category: p.category_lvl1 ?? null,
        brand: p.brand?.name ?? null,
      }));
    } else if (result.status === "rejected") {
      console.warn("[wardrobeExtractionAgent] Search failed for slot", i, result.reason?.message);
    }
    return {
      itemIndex: i,
      item: {
        type: item.type,
        description: item.description,
        category_lvl1: item.category_lvl1,
        color_primary: item.color_primary,
      },
      suggestedProducts,
    };
  });

  const validationResults = await Promise.all(
    slots.map((slot) =>
      slot.suggestedProducts.length > 0
        ? validateSlotMatchQuality(slot.item, slot.suggestedProducts)
        : Promise.resolve(null)
    )
  );

  slots = slots.map((slot, i) => {
    const validation = validationResults[i];
    if (validation && Array.isArray(validation.goodIndices)) {
      if (validation.goodIndices.length === 0) {
        slot.suggestedProducts = [];
      } else {
        const arr = slot.suggestedProducts;
        slot.suggestedProducts = validation.goodIndices.map((idx) => arr[idx]).filter(Boolean);
      }
    }
    return slot;
  });

  return {
    slots,
    look: analysis?.look ?? null,
  };
}
