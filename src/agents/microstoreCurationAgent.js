/**
 * MicroStore Curation Agent — B6
 * Goal: create great microstores with aligned image, name, and products — by system, for a user (Store for you), or assisted (manual).
 * - System: creates microstores end-to-end (name, description, hero, style notes, products, sections); batch of 5 async when triggered.
 * - Store for you: same E2E creation, personalized for one user (used by getOrCreateStoreForUser).
 * - Manual: suggest name from description; suggest products for a store/concept so user can add them.
 */

import { complete } from "../utils/llm.js";
import { generateImage } from "../utils/imageGeneration.js";
import { analyzeImage } from "../utils/imageAnalysis.js";
import {
  getOneGeneratedImage,
  createGeneratedImage,
  SOURCE_MICROSTORE_COVER,
} from "../domain/generatedImage.js";
import { getActiveCreationContextsForLLM } from "../domain/microstore/creationContext.js";
import { searchProducts } from "../domain/product/product.js";
import { getUserProfile } from "../domain/userProfile/userProfile.js";
import { listTrends } from "../domain/fashionContent/fashionContent.js";
import { getAgentPromptContent } from "../domain/agentPrompts/agentPrompts.js";
import { normalizeId } from "../core/helpers.js";
import { getPrisma } from "../core/db.js";

const AGENT_ID = "microstoreCuration";

/** Gradient IDs for "Ideas for you" cards (shared with frontend). */
const IDEA_GRADIENT_IDS = ["coral", "navy", "mint", "blush", "sage", "berry"];

const STORE_FOR_YOU_SECTIONS = ["Tops", "Bottoms", "Footwear"];
const MAX_SECTIONS = 3;
const STYLE_NOTES_COUNT = 3;

/** Preset colours for style note cards (aligned with frontend; agent uses these for suggestions). */
const STYLE_CARD_PRESETS = [
  { id: "coral", backgroundColor: "#e07a5f", fontStyle: "#1d3557" },
  { id: "navy", backgroundColor: "#1d3557", fontStyle: "#f2cc8f" },
  { id: "mint", backgroundColor: "#81b29a", fontStyle: "#1d3557" },
  { id: "blush", backgroundColor: "#f4a261", fontStyle: "#ffffff" },
  { id: "slate", backgroundColor: "#3d405b", fontStyle: "#e9c46a" },
  { id: "sage", backgroundColor: "#2a9d8f", fontStyle: "#ffffff" },
  { id: "berry", backgroundColor: "#9b5de5", fontStyle: "#ffffff" },
  { id: "cream", backgroundColor: "#fefae0", fontStyle: "#283618" },
  { id: "terracotta", backgroundColor: "#c67b5c", fontStyle: "#1a1a1a" },
  { id: "forest", backgroundColor: "#2d5a27", fontStyle: "#e8e0d5" },
  { id: "lavender", backgroundColor: "#b8a9c9", fontStyle: "#2c1810" },
  { id: "sunset", backgroundColor: "#e76f51", fontStyle: "#ffffff" },
  { id: "ocean", backgroundColor: "#0077b6", fontStyle: "#ffffff" },
  { id: "mustard", backgroundColor: "#e9c46a", fontStyle: "#1d3557" },
  { id: "rose", backgroundColor: "#e0a0a0", fontStyle: "#3d2c29" },
  { id: "charcoal", backgroundColor: "#264653", fontStyle: "#e9c46a" },
];
const PRODUCTS_PER_STORE = 50;
/** Store for you: 25–40 products. */
const PRODUCTS_PER_STORE_FOR_YOU_MIN = 25;
const PRODUCTS_PER_STORE_FOR_YOU_MAX = 40;
const PRODUCTS_PER_STORE_FOR_YOU_TARGET = 35;
const DEFAULT_SUGGESTED_PRODUCTS_LIMIT = 24;
const IDEAS_FOR_YOU_MIN = 1;
const IDEAS_FOR_YOU_MAX = 3;
const IDEAS_FOR_YOU_MAX_TOKENS = 400;
const SYSTEM_BATCH_DEFAULT_COUNT = 5;
const VALIDATE_COHERENCE_MAX_TOKENS = 200;
const PRODUCT_SUMMARIES_CAP = 20;
const SELECT_IMAGE_MAX_TOKENS = 150;
const MAX_PRODUCT_IMAGE_CANDIDATES = 12;

/** Topic seeds for system batch — varied so each run produces different stores. */
const SYSTEM_TOPIC_SEEDS = [
  "casual work denim and smart casual office wear",
  "evening and occasion wear with refined silhouettes",
  "weekend casual and relaxed street style",
  "office chic and modern professional looks",
  "minimalist and clean everyday fashion",
];

/**
 * Map product to section by category/product_type for predefined Tops/Bottoms/Footwear.
 */
function assignProductToPredefinedSection(product) {
  const cat = (product.category_lvl1 || product.product_type || "").toLowerCase();
  const title = (product.title || "").toLowerCase();
  if (cat.includes("top") || cat.includes("shirt") || cat.includes("blouse") || cat.includes("sweater") || title.includes("top ") || title.includes("shirt") || title.includes("blouse") || title.includes("sweater")) return "Tops";
  if (cat.includes("bottom") || cat.includes("pant") || cat.includes("jean") || cat.includes("short") || cat.includes("skirt") || title.includes("pant") || title.includes("jean") || title.includes("short") || title.includes("skirt")) return "Bottoms";
  if (cat.includes("shoe") || cat.includes("footwear") || cat.includes("sneaker") || cat.includes("boot") || title.includes("shoe") || title.includes("sneaker") || title.includes("boot") || title.includes("sandal")) return "Footwear";
  if (cat.includes("outerwear") || cat.includes("jacket") || title.includes("jacket") || title.includes("coat")) return "Tops";
  return "Bottoms";
}

/**
 * Generate 1–3 "Ideas for you" from user profile + fashion trends. For Store for you.
 * @param {string} userId
 * @returns {Promise<Array<{ title: string, text: string, gradientId: string }>>}
 */
export async function generateIdeasForUser(userId) {
  const uid = normalizeId(userId);
  if (!uid) return [];

  const [profile, trendsResult] = await Promise.all([
    getUserProfile(uid),
    listTrends({ limit: 15, status: "active" }),
  ]);

  const profileSummary = profile?.summary?.overall ?? "No profile yet; suggest versatile, on-trend ideas.";
  const trendList = (trendsResult?.items ?? []).slice(0, 12);
  const trendsText =
    trendList.length > 0
      ? trendList
          .map(
            (t) =>
              `- ${(t.trendName || "").trim()}: ${(t.description || t.keywords || "").toString().trim().slice(0, 120)}`
          )
          .join("\n")
      : "Current fashion: versatile, modern styles.";

  const systemPrompt = `You are a fashion advisor. Given a user's style profile and current trends, suggest 1 to 3 short "ideas for you" — personalised tips or suggestions (e.g. "Try X with Y", "This season focus on Z").
Output JSON only, no markdown, with key "ideas": array of 1 to 3 items. Each item: { "title": "short headline (3-6 words)", "text": "1-2 sentences, actionable and friendly" }.`;

  const userPrompt = `User profile summary: ${profileSummary.slice(0, 600)}

Current trends:
${trendsText}

Respond with JSON only: { "ideas": [ { "title": "...", "text": "..." }, ... ] }. Between 1 and 3 ideas.`;

  try {
    const out = await complete(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { responseFormat: "json_object", maxTokens: IDEAS_FOR_YOU_MAX_TOKENS }
    );
    const raw = Array.isArray(out?.ideas) ? out.ideas : [];
    const ideas = raw
      .slice(0, IDEAS_FOR_YOU_MAX)
      .filter((i) => i && (i.title || i.text))
      .map((i, idx) => ({
        title: String(i.title || "Idea").trim().slice(0, 80),
        text: String(i.text || "").trim().slice(0, 200),
        gradientId: IDEA_GRADIENT_IDS[idx % IDEA_GRADIENT_IDS.length],
      }));
    if (ideas.length < IDEAS_FOR_YOU_MIN && ideas.length > 0) return ideas;
    if (ideas.length < IDEAS_FOR_YOU_MIN) {
      return [
        {
          title: "Refresh your look",
          text: "Mix one trend from this season with a piece you already love for an easy update.",
          gradientId: IDEA_GRADIENT_IDS[0],
        },
      ];
    }
    return ideas;
  } catch (e) {
    console.warn("[microstoreCurationAgent] generateIdeasForUser failed:", e?.message);
    return [
      {
        title: "Curated for you",
        text: "We've picked pieces that match your style and current trends.",
        gradientId: IDEA_GRADIENT_IDS[0],
      },
    ];
  }
}

/**
 * Validate that products align with store name/description/vibe and the set is coherent.
 * @returns {{ ok: boolean, reason?: string, suggestedSearchHint?: string } | null}
 */
async function validateMicrostoreCoherence(storeName, description, vibe, productSummaries) {
  try {
    const list = (productSummaries || []).slice(0, PRODUCT_SUMMARIES_CAP);
    const prompt = `You are a quality checker for a fashion microstore.

Store name: ${(storeName || "").slice(0, 100)}
Description: ${(description || "").slice(0, 200)}
Vibe: ${(vibe || "").slice(0, 80)}

Products in the store (title, category): ${JSON.stringify(list)}

Check: (1) Do these products fit the store's name, description, and vibe? (2) Is the set coherent (not random or clearly off-topic)?

Reply with JSON only: { "ok": boolean, "reason": string | null, "suggestedSearchHint": string | null }. If ok is false, reason should briefly explain; suggestedSearchHint is an optional short phrase to refine product search (e.g. "focus on workwear blazers and tailored pants").`;

    const out = await complete(
      [
        { role: "system", content: "You output only valid JSON. No markdown or preamble." },
        { role: "user", content: prompt },
      ],
      { responseFormat: "json_object", maxTokens: VALIDATE_COHERENCE_MAX_TOKENS }
    );
    if (out && typeof out === "object") {
      return {
        ok: Boolean(out.ok),
        reason: typeof out.reason === "string" ? out.reason.trim() : null,
        suggestedSearchHint: typeof out.suggestedSearchHint === "string" ? out.suggestedSearchHint.trim() : null,
      };
    }
  } catch (e) {
    console.warn("[microstoreCurationAgent] validateMicrostoreCoherence failed:", e?.message);
  }
  return null;
}

const MAX_NAME_WORDS = 8;
const STYLE_NOTES_MIN = 2;
const STYLE_NOTES_MAX = 5;

/**
 * Validate microstore name: max 8 words, direct and understandable.
 * @returns {{ ok: boolean, reason?: string }}
 */
function validateMicrostoreName(name, vibe, trend, category) {
  const n = (name || "").trim();
  if (!n) return { ok: false, reason: "Name is empty" };
  const words = n.split(/\s+/).filter(Boolean);
  if (words.length > MAX_NAME_WORDS) {
    return { ok: false, reason: `Name has ${words.length} words (max ${MAX_NAME_WORDS}). Use a shorter, direct name.` };
  }
  return { ok: true };
}

/**
 * Validate microstore description: non-empty, aligns with store concept.
 * @returns {{ ok: boolean, reason?: string }}
 */
function validateMicrostoreDescription(name, description) {
  const d = (description || "").trim();
  if (!d) return { ok: false, reason: "Description is empty" };
  return { ok: true };
}

/**
 * Validate style notes payload: at least one link or non-empty text; each link has title or description; count in range.
 * @returns {{ ok: boolean, reason?: string }}
 */
function validateStyleNotes(styleNotesPayload) {
  const text = (styleNotesPayload?.text || "").trim();
  const links = Array.isArray(styleNotesPayload?.links) ? styleNotesPayload.links : [];
  if (!text && links.length === 0) return { ok: false, reason: "Style notes must have at least one tip or link" };
  if (links.length < STYLE_NOTES_MIN || links.length > STYLE_NOTES_MAX) {
    return { ok: false, reason: `Style notes should have ${STYLE_NOTES_MIN}–${STYLE_NOTES_MAX} items (got ${links.length})` };
  }
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const hasTitle = (link?.title || "").trim().length > 0;
    const hasDesc = (link?.description || "").trim().length > 0;
    const hasText = (link?.text || "").trim().length > 0;
    if (!hasTitle && !hasDesc && !hasText) {
      return { ok: false, reason: `Style note item ${i + 1} must have a title or description` };
    }
  }
  return { ok: true };
}

/**
 * Validate that the chosen cover image is appropriate for the store (optional LLM check).
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function validateCoverImage(imageUrl, storeName, description, vibe) {
  if (!imageUrl || !storeName) return { ok: true };
  try {
    const prompt = `Does this image URL represent a fashion microstore named "${(storeName || "").slice(0, 60)}" (${(description || "").slice(0, 80)}, vibe: ${(vibe || "").slice(0, 40)})? Reply JSON only: { "ok": boolean, "reason": string | null }.`;
    const out = await analyzeImage(imageUrl, {
      prompt,
      responseFormat: "json_object",
      maxTokens: 80,
    });
    if (out && typeof out.ok === "boolean" && !out.ok) {
      return { ok: false, reason: out.reason || "Image does not match store" };
    }
  } catch (e) {
    console.warn("[microstoreCurationAgent] validateCoverImage failed:", e?.message);
  }
  return { ok: true };
}

/**
 * Build cover image prompt from admin template or fallback. Scene-based, no text. Returns prompt string.
 */
async function buildCoverImagePrompt(opts) {
  const { name, description, vibe, trends, categories, styleReferenceText = "" } = opts;
  const template = await getAgentPromptContent(AGENT_ID, "generateCover_imageTemplate", {
    name: (name || "").trim().slice(0, 80),
    description: (description || "").trim().slice(0, 100),
    vibe: (vibe || "modern").trim().slice(0, 60),
    trends: trends ? String(trends).slice(0, 80) : "",
    categories: categories ? String(categories).slice(0, 80) : "",
  });
  if (template && typeof template === "string" && template.trim()) {
    return template.trim() + styleReferenceText;
  }
  const fallback = [
    "Fashion lifestyle hero image, editorial. Set the scene to match the store:",
    (name || "").trim().slice(0, 80),
    (description || "").trim().slice(0, 100),
    "Atmosphere:",
    (vibe || "modern").trim().slice(0, 60),
    "No text, no words, no letters on the image.",
    trends ? `Trends: ${String(trends).slice(0, 80)}` : "",
    categories ? `Categories: ${String(categories).slice(0, 80)}` : "",
  ].filter(Boolean).join(" ");
  return fallback + styleReferenceText;
}

/**
 * Choose which image to use as store cover: generated (one or more) or one of the product images.
 * @param {string|string[]} generatedImageUrl - Single URL or array of generated hero URLs (e.g. single model vs multiple models).
 * @returns {Promise<string|null>} Chosen image URL, or null if none.
 */
async function selectStoreImage(generatedImageUrl, products, storeName, description, vibe) {
  const candidates = [];
  const generatedUrls = Array.isArray(generatedImageUrl)
    ? generatedImageUrl.filter((u) => u && typeof u === "string" && u.trim())
    : generatedImageUrl && typeof generatedImageUrl === "string" && generatedImageUrl.trim()
      ? [generatedImageUrl.trim()]
      : [];
  if (generatedUrls.length === 1) {
    candidates.push({ type: "generated", url: generatedUrls[0], label: "Generated hero image" });
  } else if (generatedUrls.length > 1) {
    generatedUrls.forEach((url, i) => {
      candidates.push({ type: "generated", url, label: `Generated hero ${i + 1} (${i === 0 ? "single model" : "multiple models"})` });
    });
  }
  const productList = Array.isArray(products) ? products : [];
  for (let i = 0; i < productList.length && candidates.length < (generatedUrls.length || 1) + MAX_PRODUCT_IMAGE_CANDIDATES; i++) {
    const p = productList[i];
    const img = p?.images?.[0];
    const url = img?.src ?? img?.url;
    if (url && typeof url === "string" && url.trim()) {
      candidates.push({ type: "product", url: url.trim(), label: `Product: ${(p.title || "").slice(0, 50)}`, productIndex: i });
    }
  }
  if (candidates.length === 0) return generatedUrls[0] || null;
  if (candidates.length === 1) return candidates[0].url;

  try {
    const listText = candidates.map((c, i) => `[${i}] ${c.label}`).join("\n");
    const prompt = `Store: "${(storeName || "").slice(0, 80)}". Description: ${(description || "").slice(0, 120)}. Vibe: ${(vibe || "").slice(0, 40)}.

Which single image best represents this microstore? Options:
${listText}

Reply with JSON only: { "choiceIndex": number } (the index 0 to ${candidates.length - 1}). Prefer the generated hero (index 0) if it fits the store; otherwise pick the product image that best represents the collection.`;

    const out = await complete(
      [
        { role: "system", content: "You output only valid JSON. No markdown or preamble." },
        { role: "user", content: prompt },
      ],
      { responseFormat: "json_object", maxTokens: SELECT_IMAGE_MAX_TOKENS }
    );
    const idx = out?.choiceIndex;
    if (typeof idx === "number" && idx >= 0 && idx < candidates.length) {
      return candidates[idx].url;
    }
  } catch (e) {
    console.warn("[microstoreCurationAgent] selectStoreImage failed:", e?.message);
  }
  return candidates[0].url;
}

/**
 * Run curation: produce name, description, coverImageUrl, styleNotes, sections (max 3), vibe, trends, categories.
 * @param {Object} opts - { userId?, topic?, vibe?, trend?, category?, brandId? }
 *   - userId: "Store for you" mode — predefined sections, optional user profile in prompt
 *   - topic/vibe/trend/category: for manual/system-created store
 * @returns {Promise<{ name, description, coverImageUrl, styleNotes, sections, vibe, trends, categories }>}
 */
export async function runMicrostoreCuration(opts = {}) {
  const { userId, topic, vibe, trend, category, brandId, referenceImageUrls: optsReferenceUrls } = opts;
  const isStoreForYou = Boolean(normalizeId(userId));

  const contexts = await getActiveCreationContextsForLLM();
  const examplesText =
    contexts.length > 0
      ? contexts
          .map(
            (c) =>
              `Title: ${c.title}\nDescription: ${c.description || ""}\n${c.vibe ? `Vibe: ${c.vibe}` : ""}${c.trend ? ` Trend: ${c.trend}` : ""}${c.category ? ` Category: ${c.category}` : ""}`
          )
          .join("\n---\n")
      : "No examples configured.";

  let userContext = "";
  let trendsForSearch = "";
  if (isStoreForYou) {
    const [profile, trendsRes] = await Promise.all([
      getUserProfile(userId),
      listTrends({ limit: 12, status: "active" }),
    ]);
    const summary = profile?.summary;
    if (summary?.overall) {
      userContext = ` User profile: ${summary.overall.slice(0, 800)}.`;
    } else if (profile?.styleProfile?.data) {
      try {
        const data = typeof profile.styleProfile.data === "string" ? JSON.parse(profile.styleProfile.data) : profile.styleProfile.data;
        userContext = ` User style profile (use to tailor store): ${JSON.stringify(data).slice(0, 800)}.`;
      } catch {
        userContext = " User has a style profile; tailor the store to casual, versatile fashion.";
      }
    } else {
      userContext = " User has no detailed style profile; create a versatile, on-trend microstore.";
    }
    const trendItems = trendsRes?.items ?? [];
    if (trendItems.length > 0) {
      trendsForSearch = trendItems.map((t) => t.trendName || t.keywords).filter(Boolean).join(" ");
    }
  }

  const topicPart = topic || (isStoreForYou ? "personalized store for this user" : "curated fashion microstore");
  const systemPrompt = `You are a fashion microstore curator. Generate a microstore definition.
Use these examples of store titles and descriptions as reference (match tone and style):
${examplesText}

Output JSON only, no markdown, with keys: title, description, styleNotes, vibe, trends, categories.
- title: One short store name: max ${MAX_NAME_WORDS} words, direct and understandable (e.g. "Casual Chic Denim for Work").
- description: One sentence describing the store.
- styleNotes: Array of ${STYLE_NOTES_MIN} to ${STYLE_NOTES_MAX} short style tips. Each item: { "text": "short tip" } or { "title": "...", "url": "", "type": "text", "description": "..." }.
- vibe: One vibe/occasion string (e.g. "casual work").
- trends: Comma-separated trends.
- categories: Comma-separated categories.`;

  const userPrompt = `Create a microstore about: ${topicPart}.${userContext}
${vibe ? ` Vibe: ${vibe}.` : ""}${trend ? ` Trend: ${trend}.` : ""}${category ? ` Category: ${category}.` : ""}
Respond with JSON only.`;

  const llmOut = await complete(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { responseFormat: "json_object", maxTokens: 800 }
  );

  let title = llmOut.title || llmOut.name || "Curated Store";
  let description = llmOut.description || "";
  const vibeOut = llmOut.vibe || vibe || "";
  const trendsOut = llmOut.trends || trend || "";
  const categoriesOut = llmOut.categories || category || "";
  const nameValidation = validateMicrostoreName(title, vibeOut, trendsOut, categoriesOut);
  if (!nameValidation.ok) {
    const words = title.trim().split(/\s+/).filter(Boolean);
    if (words.length > MAX_NAME_WORDS) title = words.slice(0, MAX_NAME_WORDS).join(" ");
    console.warn("[microstoreCurationAgent] runMicrostoreCuration name validation:", nameValidation.reason);
  }
  const descValidation = validateMicrostoreDescription(title, description);
  if (!descValidation.ok && !description) description = `Curated collection: ${title}`;
  if (!descValidation.ok) console.warn("[microstoreCurationAgent] runMicrostoreCuration description validation:", descValidation.reason);

  let styleNotes = llmOut.styleNotes;
  if (!Array.isArray(styleNotes) || styleNotes.length === 0) {
    styleNotes = [{ text: "Mix textures and fits for a modern look." }];
  }
  styleNotes = styleNotes.slice(0, STYLE_NOTES_MAX).map((n) => {
    if (typeof n === "string") return { text: n };
    if (n.text) return { text: n.text };
    return { title: n.title || "Tip", url: n.url || "", type: n.type || "text", description: n.description };
  });

  const searchQuery = [title, description, vibeOut, trendsOut, trendsForSearch].filter(Boolean).join(" ");
  const productLimit = isStoreForYou ? PRODUCTS_PER_STORE_FOR_YOU_MAX : PRODUCTS_PER_STORE;
  const { items: products } = await searchProducts({
    query: searchQuery,
    brandId: normalizeId(brandId) || undefined,
    limit: productLimit,
  });

  // Store for you: single section "For you" with 25–40 products. Others: single section "All" or multi-section.
  const sectionLabels = isStoreForYou ? ["For you"] : ["All"];
  const sections = sectionLabels.map((label) => ({ label, productIds: [] }));

  if (isStoreForYou) {
    const capped = products.slice(0, Math.min(products.length, PRODUCTS_PER_STORE_FOR_YOU_MAX));
    const count = Math.max(PRODUCTS_PER_STORE_FOR_YOU_MIN, Math.min(capped.length, PRODUCTS_PER_STORE_FOR_YOU_TARGET));
    for (let i = 0; i < count && i < capped.length; i++) {
      sections[0].productIds.push(capped[i].id);
    }
  } else {
    let i = 0;
    for (const p of products) {
      sections[i % sections.length].productIds.push(p.id);
      i++;
    }
  }

  let sectionsClean = sections.map((s) => ({ label: s.label, productIds: s.productIds }));
  let currentProducts = isStoreForYou ? products.slice(0, sections[0].productIds.length) : products;
  let hasReselected = false;

  const productSummaries = currentProducts.slice(0, PRODUCT_SUMMARIES_CAP).map((p) => ({
    title: p.title ?? null,
    category_lvl1: p.category_lvl1 ?? null,
  }));
  let validation = await validateMicrostoreCoherence(title, description, vibeOut, productSummaries);
  if (validation && !validation.ok && validation.suggestedSearchHint && !hasReselected) {
    const refinedQuery = [title, description, vibeOut, validation.suggestedSearchHint].filter(Boolean).join(" ");
    const { items: reselectedProducts } = await searchProducts({
      query: refinedQuery,
      brandId: normalizeId(brandId) || undefined,
      limit: productLimit,
    });
    if (reselectedProducts.length > 0) {
      currentProducts = reselectedProducts;
      const sections2 = sectionLabels.map((label) => ({ label, productIds: [] }));
      if (isStoreForYou) {
        const capped = reselectedProducts.slice(0, PRODUCTS_PER_STORE_FOR_YOU_MAX);
        const count = Math.max(PRODUCTS_PER_STORE_FOR_YOU_MIN, Math.min(capped.length, PRODUCTS_PER_STORE_FOR_YOU_TARGET));
        for (let i = 0; i < count && i < capped.length; i++) {
          sections2[0].productIds.push(capped[i].id);
        }
      } else {
        let i = 0;
        for (const p of currentProducts) {
          sections2[i % sections2.length].productIds.push(p.id);
          i++;
        }
      }
      sectionsClean = sections2.map((s) => ({ label: s.label, productIds: s.productIds }));
      hasReselected = true;
    }
  }
  if (validation && !validation.ok && validation.reason) {
    console.warn("[microstoreCurationAgent] Coherence validation:", validation.reason);
  }

  let generatedImageUrl = null;
  const referenceUrl =
    Array.isArray(optsReferenceUrls) && optsReferenceUrls.length > 0
      ? optsReferenceUrls[0]
      : (contexts.find((c) => c.referenceImageUrl && String(c.referenceImageUrl).trim())?.referenceImageUrl ?? null);
  let styleReferenceText = "";
  if (referenceUrl && String(referenceUrl).trim()) {
    try {
      const refAnalysis = await analyzeImage(referenceUrl.trim(), {
        prompt: 'Describe the style, mood, colors, and visual tone of this image in 1-2 sentences for use as a style reference in an image generation prompt. Reply with JSON only: { "styleDescription": "your 1-2 sentence description" }. Be concise.',
        responseFormat: "json_object",
        maxTokens: 120,
      });
      const desc =
        refAnalysis?.styleDescription ??
        refAnalysis?.description ??
        refAnalysis?.look?.description ??
        (typeof refAnalysis === "string" ? refAnalysis : null);
      if (typeof desc === "string" && desc.trim()) {
        styleReferenceText = ` Style reference: ${desc.trim().slice(0, 300)}.`;
      }
    } catch (err) {
      console.warn("[microstoreCurationAgent] Reference image analysis failed:", err?.message);
    }
  }
  const cachedCover = await getOneGeneratedImage({
    sourceType: SOURCE_MICROSTORE_COVER,
    name: title,
    vibe: vibeOut || undefined,
  });
  if (cachedCover?.imageUrl) {
    generatedImageUrl = cachedCover.imageUrl;
  } else {
    const basePrompt = await buildCoverImagePrompt({
      name: title,
      description,
      vibe: vibeOut,
      trends: trendsOut,
      categories: categoriesOut,
      styleReferenceText,
    });
    const generatedUrls = [];
    try {
      const promptSingle = `${basePrompt}. One fashion model.`;
      const res1 = await generateImage(promptSingle, { aspectRatio: "3:4" });
      if (res1?.imageUrl) generatedUrls.push(res1.imageUrl);
    } catch (err) {
      console.warn("[microstoreCurationAgent] Hero image (single model) failed:", err?.message);
    }
    try {
      const promptMultiple = `${basePrompt}. Two or three fashion models.`;
      const res2 = await generateImage(promptMultiple, { aspectRatio: "3:4" });
      if (res2?.imageUrl) generatedUrls.push(res2.imageUrl);
    } catch (err) {
      console.warn("[microstoreCurationAgent] Hero image (multiple models) failed:", err?.message);
    }
    generatedImageUrl =
      generatedUrls.length > 0 ? (generatedUrls.length === 1 ? generatedUrls[0] : generatedUrls) : null;
  }

  let coverImageUrl = await selectStoreImage(generatedImageUrl, currentProducts, title, description, vibeOut);
  const isCoverFromGeneration =
    !cachedCover?.imageUrl &&
    coverImageUrl &&
    (generatedImageUrl === coverImageUrl ||
      (Array.isArray(generatedImageUrl) && generatedImageUrl.includes(coverImageUrl)));
  if (isCoverFromGeneration) {
    createGeneratedImage({
      sourceType: SOURCE_MICROSTORE_COVER,
      imageUrl: coverImageUrl,
      name: title,
      description: description || undefined,
      vibe: vibeOut || undefined,
      categories: categoriesOut || undefined,
      trends: trendsOut || undefined,
    }).catch((e) => console.warn("[microstoreCurationAgent] createGeneratedImage failed:", e?.message));
  }
  const imageValidation = await validateCoverImage(coverImageUrl, title, description, vibeOut);
  if (!imageValidation.ok && currentProducts.length > 0) {
    const firstProductImage = currentProducts[0]?.images?.[0];
    const url = firstProductImage?.src ?? firstProductImage?.url;
    if (url) {
      console.warn("[microstoreCurationAgent] Cover image validation failed, using product image:", imageValidation.reason);
      coverImageUrl = url;
    }
  }

  const styleNotesPayload = {
    text: styleNotes.find((n) => n.text)?.text || "",
    links: styleNotes.map((n, idx) => {
      const preset = STYLE_CARD_PRESETS[idx % STYLE_CARD_PRESETS.length];
      const link = {
        title: n.title || n.text || "Tip",
        url: n.url || "",
        type: (n.type || "text").toLowerCase(),
        description: n.description || n.text || "",
        backgroundColor: n.backgroundColor ?? preset.backgroundColor,
        fontStyle: n.fontStyle ?? preset.fontStyle,
      };
      if (n.imageUrl && String(n.imageUrl).trim()) link.imageUrl = String(n.imageUrl).trim();
      return link;
    }),
  };
  const styleValidation = validateStyleNotes(styleNotesPayload);
  if (!styleValidation.ok) {
    console.warn("[microstoreCurationAgent] runMicrostoreCuration style notes validation:", styleValidation.reason);
    if (styleNotesPayload.links.length < STYLE_NOTES_MIN) {
      while (styleNotesPayload.links.length < STYLE_NOTES_MIN) {
        const fallbackPreset = STYLE_CARD_PRESETS[styleNotesPayload.links.length % STYLE_CARD_PRESETS.length];
        styleNotesPayload.links.push({
          title: "Style tip",
          url: "",
          type: "text",
          description: "Mix textures and fits for a modern look.",
          backgroundColor: fallbackPreset.backgroundColor,
          fontStyle: fallbackPreset.fontStyle,
        });
      }
    }
  }

  let ideasForYou = [];
  if (isStoreForYou && userId) {
    try {
      ideasForYou = await generateIdeasForUser(userId);
    } catch (e) {
      console.warn("[microstoreCurationAgent] generateIdeasForUser failed:", e?.message);
    }
  }

  return {
    name: title,
    description,
    coverImageUrl: coverImageUrl ?? null,
    styleNotes: styleNotesPayload,
    sections: sectionsClean,
    vibe: vibeOut,
    trends: trendsOut,
    categories: categoriesOut,
    ideasForYou: ideasForYou.length > 0 ? ideasForYou : undefined,
  };
}

/**
 * Generate only the cover image for a microstore (for wizard step 2).
 * @param {Object} opts - { name, description, vibe, trends?, categories?, referenceImageUrl? }
 * @returns {Promise<{ imageUrl: string | null }>}
 */
export async function generateMicrostoreCoverImage(opts = {}) {
  const { name, description, vibe, trends, categories, referenceImageUrl } = opts;
  let styleReferenceText = "";
  const refUrl = (referenceImageUrl || "").trim();
  if (refUrl) {
    try {
      const refAnalysis = await analyzeImage(refUrl, {
        prompt:
          'Describe the style, mood, colors, and visual tone of this image in 1-2 sentences for use as a style reference in an image generation prompt. Reply with JSON only: { "styleDescription": "your 1-2 sentence description" }. Be concise.',
        responseFormat: "json_object",
        maxTokens: 120,
      });
      const desc =
        refAnalysis?.styleDescription ?? refAnalysis?.description ?? (typeof refAnalysis === "string" ? refAnalysis : null);
      if (typeof desc === "string" && desc.trim()) {
        styleReferenceText = ` Style reference: ${desc.trim().slice(0, 300)}.`;
      }
    } catch (err) {
      console.warn("[microstoreCurationAgent] Reference image analysis failed:", err?.message);
    }
  }
  const cached = await getOneGeneratedImage({
    sourceType: SOURCE_MICROSTORE_COVER,
    name: name || undefined,
    vibe: vibe || undefined,
  });
  if (cached?.imageUrl) return { imageUrl: cached.imageUrl };

  const basePrompt = await buildCoverImagePrompt({
    name,
    description,
    vibe,
    trends,
    categories,
    styleReferenceText,
  });
  const generatedUrls = [];
  try {
    const res1 = await generateImage(`${basePrompt}. One fashion model.`, { aspectRatio: "3:4" });
    if (res1?.imageUrl) generatedUrls.push(res1.imageUrl);
  } catch (err) {
    console.warn("[microstoreCurationAgent] generateMicrostoreCoverImage (single model) failed:", err?.message);
  }
  try {
    const res2 = await generateImage(`${basePrompt}. Two or three fashion models.`, { aspectRatio: "3:4" });
    if (res2?.imageUrl) generatedUrls.push(res2.imageUrl);
  } catch (err) {
    console.warn("[microstoreCurationAgent] generateMicrostoreCoverImage (multiple models) failed:", err?.message);
  }
  if (generatedUrls.length === 0) return { imageUrl: null };
  const chosen = generatedUrls.length === 1 ? generatedUrls[0] : await selectStoreImage(generatedUrls, [], name, description, vibe || "");
  if (chosen) {
    createGeneratedImage({
      sourceType: SOURCE_MICROSTORE_COVER,
      imageUrl: chosen,
      name: name || undefined,
      description: description || undefined,
      vibe: vibe || undefined,
      categories: categories || undefined,
      trends: trends || undefined,
    }).catch((e) => console.warn("[microstoreCurationAgent] createGeneratedImage failed:", e?.message));
  }
  return { imageUrl: chosen || null };
}

// ---------- Manual: name suggestion from description ----------

/**
 * Suggest a microstore name (and optional polished description + style notes) from a description.
 * For manual creation: user types description, agent returns suggested name and metadata (no products, no hero).
 */
export async function suggestMicrostoreName(opts = {}) {
  const { description, vibe, trend, category } = opts;
  const desc = (description || "").trim();
  if (!desc) {
    return { name: "", description: "", styleNotes: { text: "", links: [] }, vibe: "", trends: "", categories: "" };
  }

  const contexts = await getActiveCreationContextsForLLM();
  const examplesText =
    contexts.length > 0
      ? contexts
          .map((c) => `Title: ${c.title}\nDescription: ${c.description || ""}\n${c.vibe ? `Vibe: ${c.vibe}` : ""}${c.trend ? ` Trend: ${c.trend}` : ""}${c.category ? ` Category: ${c.category}` : ""}`)
          .join("\n---\n")
      : "No examples configured.";

  let systemPrompt = await getAgentPromptContent(AGENT_ID, "suggestName_system", { references: examplesText });
  if (!systemPrompt) {
    systemPrompt = `You are a fashion microstore curator. Given a store description, suggest a short catchy title and optionally polish the description.
Use these examples as reference (match tone and style):
${examplesText}

Output JSON only, no markdown, with keys: title, description, styleNotes, vibe, trends, categories.
- title: One short store name: max ${MAX_NAME_WORDS} words, direct and understandable, mix of trend, occasion and category.
- description: One sentence (polish the user's description if needed).
- styleNotes: Array of ${STYLE_NOTES_MIN} to ${STYLE_NOTES_MAX} short style tips. Each item: { "text": "short tip" }.
- vibe: One vibe/occasion string.
- trends: Comma-separated trends.
- categories: Comma-separated categories.`;
  }

  let userPrompt = await getAgentPromptContent(AGENT_ID, "suggestName_user", {
    description: desc,
    vibe: vibe ? ` Vibe: ${vibe}.` : "",
    trend: trend ? ` Trend: ${trend}.` : "",
    category: category ? ` Category: ${category}.` : "",
  });
  if (!userPrompt) {
    userPrompt = `Store description: ${desc}
${vibe ? ` Vibe: ${vibe}.` : ""}${trend ? ` Trend: ${trend}.` : ""}${category ? ` Category: ${category}.` : ""}
Respond with JSON only.`;
  }

  const llmOut = await complete(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { responseFormat: "json_object", maxTokens: 600 }
  );

  let title = llmOut.title || llmOut.name || "Curated Store";
  let descriptionOut = llmOut.description || desc;
  const vibeOut = llmOut.vibe || vibe || "";
  const trendsOut = llmOut.trends || trend || "";
  const categoriesOut = llmOut.categories || category || "";
  const nameValidation = validateMicrostoreName(title, vibeOut, trendsOut, categoriesOut);
  if (!nameValidation.ok) {
    const words = title.trim().split(/\s+/).filter(Boolean);
    if (words.length > MAX_NAME_WORDS) title = words.slice(0, MAX_NAME_WORDS).join(" ");
    console.warn("[microstoreCurationAgent] suggestMicrostoreName name validation:", nameValidation.reason);
  }
  const descValidation = validateMicrostoreDescription(title, descriptionOut);
  if (!descValidation.ok && !descriptionOut) descriptionOut = desc;
  if (!descValidation.ok && !descriptionOut) descriptionOut = `Curated collection: ${title}`;
  if (!descValidation.ok) console.warn("[microstoreCurationAgent] suggestMicrostoreName description validation:", descValidation.reason);

  let styleNotes = llmOut.styleNotes;
  if (!Array.isArray(styleNotes) || styleNotes.length === 0) {
    styleNotes = [{ text: "Mix textures and fits for a modern look." }];
  }
  styleNotes = styleNotes.slice(0, STYLE_NOTES_MAX).map((n) => (typeof n === "string" ? { text: n } : { text: n?.text || "Tip" }));

  const styleNotesPayload = {
    text: styleNotes.find((n) => n.text)?.text || "",
    links: styleNotes.map((n, idx) => {
      const preset = STYLE_CARD_PRESETS[idx % STYLE_CARD_PRESETS.length];
      const link = {
        title: n.text || "Tip",
        url: "",
        type: "text",
        description: n.text || "",
        backgroundColor: preset.backgroundColor,
        fontStyle: preset.fontStyle,
      };
      if (n.imageUrl && String(n.imageUrl).trim()) link.imageUrl = String(n.imageUrl).trim();
      return link;
    }),
  };
  const styleValidation = validateStyleNotes(styleNotesPayload);
  if (!styleValidation.ok) {
    console.warn("[microstoreCurationAgent] suggestMicrostoreName style notes validation:", styleValidation.reason);
    if (styleNotesPayload.links.length < STYLE_NOTES_MIN) {
      while (styleNotesPayload.links.length < STYLE_NOTES_MIN) {
        const fallbackPreset = STYLE_CARD_PRESETS[styleNotesPayload.links.length % STYLE_CARD_PRESETS.length];
        styleNotesPayload.links.push({
          title: "Style tip",
          url: "",
          type: "text",
          description: "Mix textures and fits for a modern look.",
          backgroundColor: fallbackPreset.backgroundColor,
          fontStyle: fallbackPreset.fontStyle,
        });
      }
    }
  }

  return {
    name: title,
    description: descriptionOut,
    styleNotes: styleNotesPayload,
    vibe: vibeOut,
    trends: trendsOut,
    categories: categoriesOut,
  };
}

/**
 * Suggest a single style note card for the microstore (one at a time for user to edit).
 * @returns {{ card: { title: string, description?: string, backgroundColor?: string, fontStyle?: string } }}
 */
export async function suggestOneStyleNote(opts = {}) {
  const { description, vibe, trend, category, existingTitles = [] } = opts;
  const desc = (description || "").trim();
  const contexts = await getActiveCreationContextsForLLM();
  const examplesText =
    contexts.length > 0
      ? contexts
          .map((c) => `Title: ${c.title}\nDescription: ${c.description || ""}`)
          .join("\n---\n")
      : "No examples configured.";
  const existingText = existingTitles.length > 0 ? `Existing tips (do not duplicate): ${existingTitles.join("; ")}.` : "";
  let systemPrompt = await getAgentPromptContent(AGENT_ID, "suggestOneStyleNote_system", { references: examplesText });
  if (!systemPrompt) {
    systemPrompt = `You are a fashion microstore curator. Suggest ONE short style tip as a card: title (short headline) and description (1 sentence).
Use these store examples as reference: ${examplesText}
Output JSON only: { "title": "short headline", "description": "one sentence tip" }. Keep it concise and actionable.`;
  }
  let userPrompt = await getAgentPromptContent(AGENT_ID, "suggestOneStyleNote_user", {
    description: desc || "curated fashion",
    vibe: vibe ? ` Vibe: ${vibe}.` : "",
    trend: trend ? ` Trend: ${trend}.` : "",
    category: category ? ` Category: ${category}.` : "",
    existingTitles: existingText,
  });
  if (!userPrompt) {
    userPrompt = `Store: ${desc || "curated fashion"}
${vibe ? ` Vibe: ${vibe}.` : ""}${trend ? ` Trend: ${trend}.` : ""}${category ? ` Category: ${category}.` : ""}
${existingText}
Respond with one style tip as JSON only.`;
  }
  const llmOut = await complete(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { responseFormat: "json_object", maxTokens: 150 }
  );
  const title = (llmOut.title || llmOut.text || "Style tip").toString().trim().slice(0, 80);
  const descriptionOut = (llmOut.description || llmOut.text || "").toString().trim().slice(0, 200);
  const presetIndex = existingTitles.length % STYLE_CARD_PRESETS.length;
  const preset = STYLE_CARD_PRESETS[presetIndex];
  return {
    card: {
      title: title || "Style tip",
      description: descriptionOut || undefined,
      backgroundColor: preset.backgroundColor,
      fontStyle: preset.fontStyle,
    },
  };
}

// ---------- Manual: suggest products for store or concept ----------

/**
 * Suggest products for a microstore (by storeId or by concept: name, description, vibe).
 * Returns products the user can add to the store. Optionally grouped by section.
 */
export async function suggestProductsForMicrostore(opts = {}) {
  const { storeId, name, description, vibe, limit = DEFAULT_SUGGESTED_PRODUCTS_LIMIT, brandId, groupBySection } = opts;
  const nid = normalizeId(storeId);
  const prisma = getPrisma();

  let searchName = name;
  let searchDescription = description;
  let searchVibe = vibe;
  let sectionLabels = STORE_FOR_YOU_SECTIONS;

  if (nid) {
    const store = await prisma.microStore.findUnique({
      where: { id: nid },
      select: { name: true, description: true, vibe: true, sections: true },
    });
    if (!store) return { products: [], bySection: [] };
    searchName = store.name;
    searchDescription = store.description;
    searchVibe = store.vibe;
    try {
      const parsed = typeof store.sections === "string" ? JSON.parse(store.sections) : store.sections;
      if (Array.isArray(parsed) && parsed.length > 0) {
        sectionLabels = parsed.map((s) => (s && s.label ? s.label : "")).filter(Boolean);
      }
    } catch (_) {}
  }

  const query = [searchName, searchDescription, searchVibe].filter(Boolean).join(" ");
  const { items: products } = await searchProducts({
    query: query || "fashion clothing",
    brandId: normalizeId(brandId) || undefined,
    limit: Math.min(Number(limit) || DEFAULT_SUGGESTED_PRODUCTS_LIMIT, 50),
  });

  if (!groupBySection || sectionLabels.length === 0) {
    return { products, bySection: null };
  }

  const bySection = sectionLabels.map((label) => ({ label, products: [] }));
  for (const p of products) {
    const sec = assignProductToPredefinedSection(p);
    const idx = sectionLabels.indexOf(sec);
    if (idx >= 0) bySection[idx].products.push(p);
    else bySection[0].products.push(p);
  }
  return { products, bySection };
}

// ---------- System: create one microstore E2E (persist) ----------

/**
 * Create one system microstore end-to-end: name, description, hero image, style notes, products, sections.
 * Persists the store (createdBy "system", visibility all). Used by batch or admin.
 */
export async function createSystemMicrostore(seed = null) {
  const topic = seed != null && String(seed).trim() ? String(seed).trim() : SYSTEM_TOPIC_SEEDS[Math.floor(Math.random() * SYSTEM_TOPIC_SEEDS.length)];
  const curated = await runMicrostoreCuration({ topic, brandId: undefined });
  const microstore = await import("../domain/microstore/microstore.js");
  const styleNotesStr = typeof curated.styleNotes === "string" ? curated.styleNotes : JSON.stringify(curated.styleNotes || {});

  const store = await microstore.createMicrostore({
    name: curated.name,
    description: curated.description,
    coverImageUrl: curated.coverImageUrl ?? null,
    styleNotes: styleNotesStr,
    vibe: curated.vibe ?? null,
    trends: curated.trends ?? null,
    categories: curated.categories ?? null,
    status: "draft",
    createdBy: "system",
    createdByUserId: null,
    visibilityScope: "all",
  });

  if (store && (curated.sections || []).length > 0) {
    await microstore.setMicroStoreProducts(store.id, curated.sections);
  }

  if (store) {
    try {
      await microstore.submitMicrostoreForApproval(store.id);
    } catch (e) {
      console.warn("[microstoreCurationAgent] submitForApproval after create failed:", e?.message);
    }
  }

  return store ? microstore.getMicrostore(store.id, null, true) : null;
}

// ---------- System: create 5 (or N) system microstores asynchronously ----------

/**
 * Create N system microstores asynchronously. Each store gets a different topic seed.
 * Call this without awaiting to run in background (e.g. from admin endpoint).
 * @param {number} count - Number of stores to create (default 5)
 * @returns {Promise<{ created: number, stores: Array, errors: Array<{ message: string }> >}
 */
export async function createSystemMicrostoresBatch(count = SYSTEM_BATCH_DEFAULT_COUNT) {
  const n = Math.max(1, Math.min(Number(count) || SYSTEM_BATCH_DEFAULT_COUNT, 10));
  const seeds = [...SYSTEM_TOPIC_SEEDS];
  while (seeds.length < n) {
    seeds.push(`curated fashion theme ${seeds.length + 1}`);
  }
  const toUse = seeds.slice(0, n);

  const results = await Promise.allSettled(toUse.map((seed) => createSystemMicrostore(seed)));

  const stores = [];
  const errors = [];
  results.forEach((out, i) => {
    if (out.status === "fulfilled" && out.value) stores.push(out.value);
    if (out.status === "rejected") errors.push({ message: out.reason?.message || String(out.reason) });
  });

  return { created: stores.length, stores, errors };
}

/**
 * Start creating N system microstores in the background. Returns immediately.
 * Use from admin: POST /admin/microstores/create-system-batch { count: 5 }
 */
export function startSystemMicrostoresBatch(count = SYSTEM_BATCH_DEFAULT_COUNT) {
  createSystemMicrostoresBatch(count)
    .then((result) => {
      console.log("[microstoreCurationAgent] System batch completed:", result.created, "stores created", result.errors?.length || 0, "errors");
    })
    .catch((err) => {
      console.error("[microstoreCurationAgent] System batch failed:", err?.message);
    });
}
