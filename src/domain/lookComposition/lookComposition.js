/**
 * B2.3 Look Composition Service
 * Pure build: vibe, occasion, productIds, anchorProductId, or constraints → one look (product list + optional generated image).
 * Supports anchor product + complementary products, image validate+regenerate, userContext for personalization.
 */

import { getProduct, listProducts } from "../product/product.js";
import { generateImage } from "../../utils/imageGeneration.js";
import { analyzeImage } from "../../utils/imageAnalysis.js";
import { normalizeId } from "../../core/helpers.js";

const DEFAULT_LOOK_PRODUCT_LIMIT = 8;
const MAX_PRODUCT_IDS = 20;
const COMPLEMENTARY_PER_CATEGORY = 2;
const IMAGE_VALIDATE_MAX_RETRIES = 2;

/** Static mapping: anchor category_lvl1 → complementary category_lvl1 values for a full look. */
const COMPLEMENTARY_CATEGORIES = {
  Tops: ["Bottoms", "Footwear"],
  Shirts: ["Bottoms", "Footwear"],
  "T-Shirts": ["Bottoms", "Footwear"],
  Bottoms: ["Tops", "Footwear"],
  Trousers: ["Tops", "Footwear"],
  Jeans: ["Tops", "Footwear"],
  Dresses: ["Footwear", "Accessories"],
  Skirts: ["Tops", "Footwear"],
  Outerwear: ["Tops", "Bottoms", "Footwear"],
  Footwear: ["Tops", "Bottoms"],
  Accessories: ["Tops", "Bottoms", "Footwear"],
  Bags: ["Tops", "Bottoms", "Footwear"],
};
const DEFAULT_COMPLEMENTARY = ["Tops", "Bottoms", "Footwear"];

/**
 * Build one look from vibe, occasion, productIds, anchorProductId, or constraints.
 * @param {Object} opts
 * @param {string} [opts.vibe]
 * @param {string} [opts.occasion]
 * @param {string[]} [opts.productIds] - If provided, fetch these products as the look.
 * @param {string} [opts.anchorProductId] - If provided, build look around this product (anchor + complementary).
 * @param {Object} [opts.constraints] - { category_lvl1?, occasion_primary?, mood_vibe?, limit? } when productIds/anchor not provided.
 * @param {Object} [opts.userContext] - Optional: preferredVibe?, preferredOccasion?, preferredCategoryLvl1? (array). Used for defaults and preferred categories.
 * @param {boolean} [opts.generateImage] - If true, generate an image and validate; regenerate if invalid (up to IMAGE_VALIDATE_MAX_RETRIES).
 * @param {string} [opts.imageStyle] - "flat_lay" | "on_model". Flat lay = items laid out; on_model = outfit on a person. Default "flat_lay".
 * @returns {Promise<{ products: Object[], productIds: string[], imageUrl?: string, lookImageStyle?: string, vibe?: string, occasion?: string }>}
 */
export async function composeLook(opts = {}) {
  const {
    vibe,
    occasion,
    productIds: inputIds,
    anchorProductId,
    constraints = {},
    userContext,
    generateImage: doGenerateImage,
    imageStyle = "flat_lay",
  } = opts;

  const resolvedImageStyle = imageStyle === "on_model" ? "on_model" : "flat_lay";

  const resolvedVibe = vibe ?? userContext?.preferredVibe ?? null;
  const resolvedOccasion = occasion ?? userContext?.preferredOccasion ?? null;
  const preferredCategories = Array.isArray(userContext?.preferredCategoryLvl1)
    ? userContext.preferredCategoryLvl1
    : [];

  let products = [];
  let productIds = [];

  const anchorId = normalizeId(anchorProductId);
  if (anchorId) {
    const anchorLook = await buildLookFromAnchor(anchorId, resolvedVibe, resolvedOccasion, preferredCategories);
    products = anchorLook.products;
    productIds = anchorLook.productIds;
  } else if (Array.isArray(inputIds) && inputIds.length > 0) {
    const ids = inputIds.slice(0, MAX_PRODUCT_IDS).map((id) => normalizeId(id)).filter(Boolean);
    const fetched = await Promise.all(ids.map((id) => getProduct(id)));
    products = fetched.filter(Boolean).map(toProductSummary);
    productIds = products.map((p) => p.id);
  } else {
    const limit = Math.min(
      Number(constraints.limit) || DEFAULT_LOOK_PRODUCT_LIMIT,
      DEFAULT_LOOK_PRODUCT_LIMIT
    );
    const cat = constraints.category_lvl1 ?? preferredCategories[0];
    const { items } = await listProducts({
      limit,
      offset: 0,
      category_lvl1: cat || undefined,
      occasion_primary: constraints.occasion_primary ?? resolvedOccasion,
      mood_vibe: constraints.mood_vibe ?? resolvedVibe,
    });
    products = items.map(toProductSummary);
    productIds = products.map((p) => p.id);
  }

  let imageUrl;
  if (doGenerateImage && products.length > 0) {
    imageUrl = await generateAndValidateLookImage(
      { vibe: resolvedVibe, occasion: resolvedOccasion, products },
      IMAGE_VALIDATE_MAX_RETRIES,
      resolvedImageStyle
    );
  }

  return {
    products,
    productIds,
    ...(imageUrl && { imageUrl }),
    lookImageStyle: resolvedImageStyle,
    ...(resolvedVibe && { vibe: resolvedVibe }),
    ...(resolvedOccasion && { occasion: resolvedOccasion }),
  };
}

/**
 * Build look from anchor product + complementary categories (static mapping).
 */
async function buildLookFromAnchor(anchorProductId, vibe, occasion, preferredCategories) {
  const anchor = await getProduct(anchorProductId);
  if (!anchor) return { products: [], productIds: [] };

  const anchorSummary = toProductSummary(anchor);
  const anchorCategory = (anchor.category_lvl1 || anchor.product_type || "").trim() || null;
  const compCategories = anchorCategory
    ? COMPLEMENTARY_CATEGORIES[anchorCategory] ?? DEFAULT_COMPLEMENTARY
    : DEFAULT_COMPLEMENTARY;

  const order = preferredCategories.length
    ? [...new Set([...preferredCategories.filter((c) => compCategories.includes(c)), ...compCategories])]
    : compCategories;

  const products = [anchorSummary];
  const seenIds = new Set([anchor.id]);

  for (const cat of order) {
    if (cat === anchorCategory) continue;
    const { items } = await listProducts({
      limit: COMPLEMENTARY_PER_CATEGORY,
      offset: 0,
      category_lvl1: cat,
      occasion_primary: occasion || undefined,
      mood_vibe: vibe || undefined,
    });
    for (const p of items) {
      if (seenIds.has(p.id)) continue;
      seenIds.add(p.id);
      products.push(toProductSummary(p));
      if (products.length >= DEFAULT_LOOK_PRODUCT_LIMIT) break;
    }
    if (products.length >= DEFAULT_LOOK_PRODUCT_LIMIT) break;
  }

  return {
    products,
    productIds: products.map((p) => p.id),
  };
}

const IMAGE_VALIDATION_PROMPT_FLAT_LAY = `Does this image show a coherent flat lay of fashion items (clothing/accessories arranged together, no person, no major artifacts)? Return a single JSON object with exactly: "coherent" (boolean), "qualityOk" (boolean), "reason" (string, brief explanation).`;

const IMAGE_VALIDATION_PROMPT_ON_MODEL = `Does this image show a coherent outfit worn on a person/model (full body or clear outfit on figure, no major artifacts)? Return a single JSON object with exactly: "coherent" (boolean), "qualityOk" (boolean), "reason" (string, brief explanation).`;

/**
 * Generate look image and validate; retry with refined prompt if invalid.
 * @param {Object} lookContext - { vibe, occasion, products }
 * @param {number} maxRetries
 * @param {string} imageStyle - "flat_lay" | "on_model"
 */
async function generateAndValidateLookImage(lookContext, maxRetries, imageStyle = "flat_lay") {
  const validationPrompt =
    imageStyle === "on_model" ? IMAGE_VALIDATION_PROMPT_ON_MODEL : IMAGE_VALIDATION_PROMPT_FLAT_LAY;
  let lastUrl = null;
  let lastReason = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const prompt =
      attempt === 0
        ? buildLookImagePrompt(lookContext, "", imageStyle)
        : buildLookImagePrompt(lookContext, lastReason, imageStyle);
    try {
      const result = await generateImage(prompt, { aspectRatio: "3:4" });
      const imageUrl = result?.imageUrl ?? null;
      if (!imageUrl) continue;
      lastUrl = imageUrl;
      const validation = await analyzeImage(imageUrl, {
        prompt: validationPrompt,
        responseFormat: "json_object",
        maxTokens: 200,
      });
      const coherent = validation?.coherent === true;
      const qualityOk = validation?.qualityOk === true;
      if (coherent && qualityOk) return imageUrl;
      lastReason = validation?.reason || "Image not coherent or quality insufficient.";
    } catch (err) {
      console.warn("[lookComposition] generateImage or validate failed:", err?.message);
      if (attempt === maxRetries) return lastUrl;
    }
  }
  return lastUrl;
}

function toProductSummary(p) {
  const img = p.images?.[0];
  return {
    id: p.id,
    title: p.title,
    brandName: p.brand?.name ?? null,
    imageUrl: img?.src ?? null,
    handle: p.handle ?? null,
  };
}

/**
 * Build image generation prompt for the look. Two styles: flat_lay (items laid out) or on_model (outfit on a person).
 * @param {{ vibe?: string, occasion?: string, products: Object[] }} lookContext
 * @param {string} refineReason
 * @param {string} imageStyle - "flat_lay" | "on_model"
 */
function buildLookImagePrompt({ vibe, occasion, products }, refineReason = "", imageStyle = "flat_lay") {
  const titles = products?.length
    ? products.slice(0, 6).map((p) => p.title).filter(Boolean).join(", ")
    : "";
  if (imageStyle === "on_model") {
    const parts = ["Fashion look, full outfit worn on a model, full body"];
    if (vibe) parts.push(`${vibe} vibe`);
    if (occasion) parts.push(`for ${occasion}`);
    if (titles) parts.push(`Outfit featuring: ${titles}`);
    parts.push("clean background, high quality, editorial style");
    if (refineReason) parts.push(`Avoid: ${refineReason}`);
    return parts.join(". ");
  }
  const parts = ["Fashion look, full outfit flat lay, items arranged together"];
  if (vibe) parts.push(`${vibe} vibe`);
  if (occasion) parts.push(`for ${occasion}`);
  if (titles) parts.push(`featuring: ${titles}`);
  parts.push("clean background, high quality");
  if (refineReason) parts.push(`Avoid: ${refineReason}`);
  return parts.join(". ");
}
