/**
 * Full Wardrobe Agent
 * Single entry point for wardrobe: analyze single items (upload path) and extract items from looks (look path).
 * Taxonomy: category_lvl1, type (clothing | footwear | accessory), color aligned between analyzeItem and extractFromLook.
 */

import { randomUUID } from "crypto";
import { analyzeImage } from "../utils/imageAnalysis.js";
import { complete } from "../utils/llm.js";
import { resolveColor, getCanonicalColorNames } from "../utils/colorUtils.js";
import { resolveImageUrlForExternal, uploadFile, fetchUrlToBuffer } from "../utils/storage.js";
import { cropByBbox, hasValidBbox, getNormalizedBbox } from "../utils/cropImage.js";
import { searchProducts } from "../domain/product/product.js";
import { getLook } from "../domain/looks/look.js";

/** Number of product suggestions per extracted item. */
const SUGGESTIONS_PER_SLOT = 5;
const VALIDATE_MATCH_MAX_TOKENS = 150;
const CROP_MATCH_MAX_TOKENS = 50;
const ANALYZE_ITEM_MAX_TOKENS = 150;

/** Canonical colour list for LLM: pick one so we map name→hex and compute saturation/lightness in code. */
const CANONICAL_COLOR_LIST = getCanonicalColorNames().join(", ");

/** Single-item analysis: same taxonomy as extraction. Colour: LLM picks ONE name from list; we derive hex and saturation/lightness in code. */
const ANALYZE_ITEM_PROMPT = `This image shows a single clothing, footwear, or accessory item (or one main item). Return a JSON object with exactly these keys:
- type: "clothing" | "footwear" | "accessory"
- category: string (e.g. Shirt, Pants, Dress, Shoes, Bag, Jacket — use same category_lvl1 style as Tops, Shirts, Blouse)
- color: string (REQUIRED — pick exactly ONE from this list, the best match for the dominant colour: ${CANONICAL_COLOR_LIST}. Use the exact spelling from the list.)
- description: string (one short phrase, e.g. "Blue casual shirt", "Denim skinny jeans")`;

/** Vision prompt: bbox per item; colour = ONE name from list so we derive hex and saturation in code. */
const WARDROBE_EXTRACTION_PROMPT = `Analyze this fashion/outfit image. Return a single JSON object with exactly two keys: "items" and "look".

Colour: For each item set "color" to exactly ONE colour from this list (the best match for the dominant colour): ${CANONICAL_COLOR_LIST}. Use exact spelling from the list. We will derive the exact hex and saturation from this name.

"items": array of objects, one per visible item (clothing, footwear, accessories). For each item include (use null when not detectable):
- type: "clothing" | "footwear" | "accessory"
- description: string (full description)
- category_lvl1, category_lvl2, category_lvl3: string (e.g. Tops, Shirts, Blouse)
- color: string (REQUIRED — one from the list above)
- color_primary: string (same as color, for compatibility)
- bbox: REQUIRED for every item. Use exactly these keys with normalized coordinates (0 to 1): { "x": number, "y": number, "w": number, "h": number } where x,y is the top-left corner and w,h are width and height (each 0-1). The bbox must tightly enclose only the single clothing/footwear/accessory item described, with minimal background. Do not use regions that are mostly sky, buildings, or other objects — only the item itself. Use only x, y, w, h.

"look": one object for the overall look:
- description: string
- vibe: string (e.g. casual, formal)
- occasion: string
- timeOfDay: string or null
- labels: array of strings
- comment: one short sentence`;

// --- analyzeItem (upload path) ---

/** Normalize hex to #RRGGBB (lowercase). Returns null if invalid. */
function normalizeHex(v) {
  if (v == null || typeof v !== "string") return null;
  const s = v.trim().replace(/^#/, "");
  if (/^[0-9A-Fa-f]{6}$/.test(s)) return `#${s.toLowerCase()}`;
  if (/^[0-9A-Fa-f]{3}$/.test(s)) {
    const r = s[0] + s[0], g = s[1] + s[1], b = s[2] + s[2];
    return `#${r}${g}${b}`.toLowerCase();
  }
  return null;
}

const BRIGHTNESS_VALUES = new Set(["dark", "medium", "light"]);
const SATURATION_VALUES = new Set(["muted", "medium", "vivid"]);

/**
 * Analyze a single wardrobe item image. Used after upload to label the item (category, color, tags).
 * Returns hex as canonical colour; brightness, saturation, isNeutral per docs/COLOR_TERMINOLOGY.md.
 * @param {string|Buffer} imageUrlOrBuffer - Image as URL (resolved if our storage) or buffer
 * @returns {Promise<{ category, color, colorHex, colorBrightness, colorSaturation, colorIsNeutral, tags, type }>}
 */
export async function analyzeItem(imageUrlOrBuffer) {
  let input = imageUrlOrBuffer;
  if (typeof imageUrlOrBuffer === "string" && imageUrlOrBuffer.trim()) {
    input = await resolveImageUrlForExternal(imageUrlOrBuffer.trim());
  }
  const result = await analyzeImage(input, {
    prompt: ANALYZE_ITEM_PROMPT,
    responseFormat: "json_object",
    maxTokens: ANALYZE_ITEM_MAX_TOKENS,
  });
  const category = result?.category != null ? String(result.category).trim() || null : null;
  const colorName = result?.color != null ? String(result.color).trim() || null : null;
  const description = result?.description != null ? String(result.description).trim() || null : null;
  const type = result?.type != null ? String(result.type).trim() || null : null;
  const resolved = colorName ? resolveColor(colorName) : null;
  const colorHex = resolved?.hex ?? normalizeHex(result?.color_hex ?? result?.colorHex) ?? null;
  const colorBrightness = resolved?.brightnessLabel ?? (result?.color_brightness != null && BRIGHTNESS_VALUES.has(String(result.color_brightness).toLowerCase()) ? String(result.color_brightness).toLowerCase() : null);
  const colorSaturation = resolved?.saturationLabel ?? (result?.color_saturation != null && SATURATION_VALUES.has(String(result.color_saturation).toLowerCase()) ? String(result.color_saturation).toLowerCase() : null);
  const colorIsNeutral = resolved ? resolved.isNeutral : (result?.color_is_neutral === true || result?.colorIsNeutral === true);
  const colorSaturationPercent = resolved?.saturationPercent ?? null;
  const colorLightnessPercent = resolved?.lightnessPercent ?? null;
  return {
    category: category || null,
    color: colorName || null,
    colorHex: colorHex || null,
    colorBrightness: colorBrightness || null,
    colorSaturation: colorSaturation || null,
    colorSaturationPercent: colorSaturationPercent != null ? colorSaturationPercent : null,
    colorLightnessPercent: colorLightnessPercent != null ? colorLightnessPercent : null,
    colorIsNeutral: colorHex ? colorIsNeutral : null,
    tags: description || null,
    type: type || null,
  };
}

// --- extractFromLook helpers and run ---

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
 * Check if a crop image matches the given item description (step 1 validation).
 */
async function cropMatchesDescription(cropBufferOrDataUrl, itemDescription) {
  const desc = (itemDescription && String(itemDescription).trim()) || "a clothing item";
  try {
    const prompt = `This image is a crop from a larger outfit photo. Does this crop show exactly one clothing/footwear/accessory item that matches this description: "${desc.slice(0, 200)}"? If the crop shows mostly background, sky, buildings, or something other than the described item, reply with { "matches": false }. Reply with JSON only: { "matches": true } or { "matches": false }.`;
    const out = await analyzeImage(cropBufferOrDataUrl, {
      prompt,
      responseFormat: "json_object",
      maxTokens: CROP_MATCH_MAX_TOKENS,
    });
    return out && out.matches === true;
  } catch (e) {
    console.warn("[wardrobeAgent] cropMatchesDescription failed:", e?.message);
    return false;
  }
}

/**
 * Validate which suggested products match the extracted item. Returns indices to keep.
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
    console.warn("[wardrobeAgent] validateSlotMatchQuality failed:", e?.message);
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
  if (suggestedProducts.length > 2) {
    const validation = await validateSlotMatchQuality(item || {}, suggestedProducts);
    if (validation && Array.isArray(validation.goodIndices)) {
      if (validation.goodIndices.length > 0) {
        suggestedProducts = validation.goodIndices.map((idx) => suggestedProducts[idx]).filter(Boolean);
      } else {
        suggestedProducts = suggestedProducts.slice(0, 2);
      }
    }
  }
  return { suggestedProducts };
}

/**
 * Extract items from a look image. Crop → catalog → slots with suggestedProducts and cropImageUrl.
 * @param {Object} input - { lookId?: string, imageUrl?: string, imageBuffer?: Buffer, contentType?: string }
 * @param {Object} context - { userId: string } (optional; for ownership check and crop upload path)
 * @returns {Promise<{ slots: Array<{ itemIndex, item, suggestedProducts, cropImageUrl? }>, look?, error? }>}
 */
export async function extractFromLook(input, context = {}) {
  const { lookId, imageUrl, imageBuffer } = input || {};
  const userId = context?.userId || "anonymous";

  let imageForAnalysis = imageUrl;
  if (lookId) {
    const look = await getLook(lookId);
    if (!look) {
      return { slots: [], error: "Look not found" };
    }
    if (userId && userId !== "anonymous" && look.userId && look.userId !== userId) {
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

  const imageInput =
    typeof imageForAnalysis === "string"
      ? await resolveImageUrlForExternal(imageForAnalysis)
      : imageForAnalysis;

  let imageBufferForCrop = Buffer.isBuffer(imageForAnalysis) ? imageForAnalysis : null;
  if (!imageBufferForCrop && typeof imageForAnalysis === "string") {
    try {
      const resolved = await resolveImageUrlForExternal(imageForAnalysis);
      imageBufferForCrop = await fetchUrlToBuffer(resolved);
    } catch (e) {
      const urlPreview =
        typeof imageForAnalysis === "string" && imageForAnalysis.length > 80
          ? imageForAnalysis.slice(0, 80) + "..."
          : imageForAnalysis;
      console.warn(
        "[wardrobeAgent] Could not fetch image for crops:",
        e?.message,
        "| urlPreview:",
        urlPreview
      );
    }
  }

  let analysis;
  try {
    analysis = await analyzeImage(imageInput, {
      prompt: WARDROBE_EXTRACTION_PROMPT,
      responseFormat: "json_object",
    });
  } catch (err) {
    console.warn("[wardrobeAgent] Image analysis failed:", err?.message);
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

  const itemsWithBbox = items.filter((it) => hasValidBbox(it));
  console.info(
    "[wardrobeAgent] items:",
    items.length,
    "with bbox:",
    itemsWithBbox.length,
    "imageBufferForCrop:",
    !!imageBufferForCrop
  );

  const slotPromises = items.map(async (item, i) => {
    const colorName = item.color ?? item.color_primary ?? item.color_name;
    const resolved = colorName ? resolveColor(colorName) : null;
    const slotItem = {
      type: item.type,
      description: item.description,
      category_lvl1: item.category_lvl1,
      color_primary: colorName ?? null,
      color_hex: resolved?.hex ?? item.color_hex ?? item.colorHex ?? null,
      color_name: colorName ?? null,
      color_brightness: resolved?.brightnessLabel ?? item.color_brightness ?? item.colorBrightness ?? null,
      color_saturation: resolved?.saturationLabel ?? item.color_saturation ?? item.colorSaturation ?? null,
      color_saturation_percent: resolved?.saturationPercent ?? null,
      color_lightness_percent: resolved?.lightnessPercent ?? null,
      color_is_neutral: resolved ? resolved.isNeutral : (item.color_is_neutral === true || item.colorIsNeutral === true),
    };
    let suggestedProducts = [];
    let cropImageUrl = null;

    const useCrop = imageBufferForCrop && hasValidBbox(item);
    let cropPassedCheck = false;
    if (useCrop) {
      try {
        const bbox = getNormalizedBbox(item);
        const cropBuffer = await cropByBbox(imageBufferForCrop, bbox, { format: "jpeg", quality: 90 });
        const cropDataUrl = `data:image/jpeg;base64,${cropBuffer.toString("base64")}`;
        cropPassedCheck = await cropMatchesDescription(cropDataUrl, item.description);
        if (!cropPassedCheck) {
          console.info("[wardrobeAgent] slot", i, "crop check failed, not showing crop");
        }
        if (cropPassedCheck) {
          const key = `wardrobe/${userId}/crops/${randomUUID()}.jpg`;
          const { url } = await uploadFile(cropBuffer, key, "image/jpeg", { requireRemote: false });
          cropImageUrl = url;
          let searchResult = await searchProducts({
            imageUrl: cropDataUrl,
            category_lvl1: item.category_lvl1 || undefined,
            limit: SUGGESTIONS_PER_SLOT,
            offset: 0,
          });
          if (!searchResult?.items?.length && item.category_lvl1) {
            searchResult = await searchProducts({
              imageUrl: cropDataUrl,
              limit: SUGGESTIONS_PER_SLOT,
              offset: 0,
            });
          }
          if (searchResult?.items?.length) {
            suggestedProducts = searchResult.items.map((p) => ({
              productId: p.id,
              title: p.title,
              imageUrl: p.images?.[0]?.src ?? null,
              category: p.category_lvl1 ?? null,
              brand: p.brand?.name ?? null,
            }));
          }
        }
      } catch (e) {
        console.warn("[wardrobeAgent] Crop or image search failed for slot", i, e?.message);
      }
    }

    if (suggestedProducts.length > 0) {
      if (suggestedProducts.length <= 2) {
        // Keep all
      } else {
        const validation = await validateSlotMatchQuality(slotItem, suggestedProducts);
        if (validation && Array.isArray(validation.goodIndices) && validation.goodIndices.length > 0) {
          suggestedProducts = validation.goodIndices.map((idx) => suggestedProducts[idx]).filter(Boolean);
        } else {
          suggestedProducts = suggestedProducts.slice(0, 2);
        }
      }
    }

    if (suggestedProducts.length === 0) {
      let searchResult = await searchProducts({
        query: itemToSearchQuery(item),
        category_lvl1: item.category_lvl1 || undefined,
        limit: SUGGESTIONS_PER_SLOT,
        offset: 0,
      });
      if (!searchResult?.items?.length && item.category_lvl1) {
        searchResult = await searchProducts({
          query: itemToSearchQuery(item),
          limit: SUGGESTIONS_PER_SLOT,
          offset: 0,
        });
      }
      if (searchResult?.items?.length) {
        suggestedProducts = searchResult.items.map((p) => ({
          productId: p.id,
          title: p.title,
          imageUrl: p.images?.[0]?.src ?? null,
          category: p.category_lvl1 ?? null,
          brand: p.brand?.name ?? null,
        }));
        if (suggestedProducts.length > 2) {
          const validation = await validateSlotMatchQuality(slotItem, suggestedProducts);
          if (validation && Array.isArray(validation.goodIndices) && validation.goodIndices.length > 0) {
            suggestedProducts = validation.goodIndices.map((idx) => suggestedProducts[idx]).filter(Boolean);
          } else if (validation && Array.isArray(validation.goodIndices) && validation.goodIndices.length === 0) {
            suggestedProducts = suggestedProducts.slice(0, 2);
          }
        }
      }
    }

    return {
      itemIndex: i,
      item: slotItem,
      suggestedProducts,
      cropImageUrl: cropImageUrl || undefined,
    };
  });

  const slots = await Promise.all(slotPromises);
  const withCrop = slots.filter((s) => s.cropImageUrl).length;
  const withSuggestions = slots.filter((s) => s.suggestedProducts?.length > 0).length;
  console.info(
    "[wardrobeAgent] done: slots:",
    slots.length,
    "with crop:",
    withCrop,
    "with suggestions:",
    withSuggestions
  );

  return {
    slots,
    look: analysis?.look ?? null,
  };
}

/** Backward-compat alias: run = extractFromLook */
export const run = extractFromLook;
