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
import { getActiveCreationContextsForLLM } from "../domain/microstore/creationContext.js";
import { searchProducts } from "../domain/product/product.js";
import { getUserProfile } from "../domain/userProfile/userProfile.js";
import { normalizeId } from "../core/helpers.js";
import { getPrisma } from "../core/db.js";

const STORE_FOR_YOU_SECTIONS = ["Tops", "Bottoms", "Footwear"];
const MAX_SECTIONS = 3;
const STYLE_NOTES_COUNT = 3;
const PRODUCTS_PER_STORE = 30;
const DEFAULT_SUGGESTED_PRODUCTS_LIMIT = 24;
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

/**
 * Choose which image to use as store cover: generated or one of the product images.
 * @returns {Promise<string|null>} Chosen image URL, or null if none.
 */
async function selectStoreImage(generatedImageUrl, products, storeName, description, vibe) {
  const candidates = [];
  if (generatedImageUrl && typeof generatedImageUrl === "string" && generatedImageUrl.trim()) {
    candidates.push({ type: "generated", url: generatedImageUrl.trim(), label: "Generated hero image" });
  }
  const productList = Array.isArray(products) ? products : [];
  for (let i = 0; i < productList.length && candidates.length < 1 + MAX_PRODUCT_IMAGE_CANDIDATES; i++) {
    const p = productList[i];
    const img = p?.images?.[0];
    const url = img?.src ?? img?.url;
    if (url && typeof url === "string" && url.trim()) {
      candidates.push({ type: "product", url: url.trim(), label: `Product: ${(p.title || "").slice(0, 50)}`, productIndex: i });
    }
  }
  if (candidates.length === 0) return generatedImageUrl || null;
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
  if (isStoreForYou) {
    const profile = await getUserProfile(userId);
    if (profile?.styleProfile?.data) {
      try {
        const data = typeof profile.styleProfile.data === "string" ? JSON.parse(profile.styleProfile.data) : profile.styleProfile.data;
        userContext = ` User style profile (use to tailor store): ${JSON.stringify(data).slice(0, 800)}.`;
      } catch {
        userContext = " User has a style profile; tailor the store to casual, versatile fashion.";
      }
    } else {
      userContext = " User has no detailed style profile; create a versatile, on-trend microstore.";
    }
  }

  const topicPart = topic || (isStoreForYou ? "personalized store for this user" : "curated fashion microstore");
  const systemPrompt = `You are a fashion microstore curator. Generate a microstore definition.
Use these examples of store titles and descriptions as reference (match tone and style):
${examplesText}

Output JSON only, no markdown, with keys: title, description, styleNotes, vibe, trends, categories.
- title: One short, catchy store name (e.g. "Casual Chic Denim for Work").
- description: One sentence describing the store.
- styleNotes: Array of 2 to ${STYLE_NOTES_COUNT} short style tips. Each item: { "text": "short tip" } or { "title": "...", "url": "", "type": "text", "description": "..." }.
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

  const title = llmOut.title || llmOut.name || "Curated Store";
  const description = llmOut.description || "";
  const vibeOut = llmOut.vibe || vibe || "";
  const trendsOut = llmOut.trends || trend || "";
  const categoriesOut = llmOut.categories || category || "";
  let styleNotes = llmOut.styleNotes;
  if (!Array.isArray(styleNotes) || styleNotes.length === 0) {
    styleNotes = [{ text: "Mix textures and fits for a modern look." }];
  }
  styleNotes = styleNotes.slice(0, STYLE_NOTES_COUNT).map((n) => {
    if (typeof n === "string") return { text: n };
    if (n.text) return { text: n.text };
    return { title: n.title || "Tip", url: n.url || "", type: n.type || "text", description: n.description };
  });

  const searchQuery = [title, description, vibeOut, trendsOut].filter(Boolean).join(" ");
  const { items: products } = await searchProducts({
    query: searchQuery,
    brandId: normalizeId(brandId) || undefined,
    limit: PRODUCTS_PER_STORE,
  });

  const sectionLabels = isStoreForYou ? STORE_FOR_YOU_SECTIONS : (llmOut.sectionLabels && Array.isArray(llmOut.sectionLabels) ? llmOut.sectionLabels.slice(0, MAX_SECTIONS) : ["Tops", "Bottoms", "Accessories"]);

  const sections = sectionLabels.map((label) => ({ label, productIds: [] }));
  if (isStoreForYou) {
    for (const p of products) {
      const sec = assignProductToPredefinedSection(p);
      const idx = sectionLabels.indexOf(sec);
      if (idx >= 0 && sections[idx].productIds.length < 20) sections[idx].productIds.push(p.id);
    }
    for (const p of products) {
      if (sections.every((s) => !s.productIds.includes(p.id))) {
        const idx = sectionLabels.indexOf(assignProductToPredefinedSection(p));
        if (idx >= 0 && sections[idx].productIds.length < 20) sections[idx].productIds.push(p.id);
      }
    }
  } else {
    let i = 0;
    for (const p of products) {
      sections[i % sections.length].productIds.push(p.id);
      i++;
    }
  }

  let sectionsClean = sections.map((s) => ({ label: s.label, productIds: s.productIds }));
  let currentProducts = products;
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
      limit: PRODUCTS_PER_STORE,
    });
    if (reselectedProducts.length > 0) {
      currentProducts = reselectedProducts;
      const sections2 = sectionLabels.map((label) => ({ label, productIds: [] }));
      if (isStoreForYou) {
        for (const p of currentProducts) {
          const sec = assignProductToPredefinedSection(p);
          const idx = sectionLabels.indexOf(sec);
          if (idx >= 0 && sections2[idx].productIds.length < 20) sections2[idx].productIds.push(p.id);
        }
        for (const p of currentProducts) {
          if (sections2.every((s) => !s.productIds.includes(p.id))) {
            const idx = sectionLabels.indexOf(assignProductToPredefinedSection(p));
            if (idx >= 0 && sections2[idx].productIds.length < 20) sections2[idx].productIds.push(p.id);
          }
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
  const imagePromptParts = [
    "Fashion lifestyle hero image, editorial, clean background, no text",
    vibeOut || "modern style",
    title,
    description ? description.slice(0, 100) : "",
    trendsOut ? `Trends: ${trendsOut.slice(0, 80)}` : "",
    categoriesOut ? `Categories: ${categoriesOut.slice(0, 80)}` : "",
  ].filter(Boolean);
  const imagePrompt = imagePromptParts.join(", ") + styleReferenceText;

  try {
    const { imageUrl } = await generateImage(imagePrompt, { aspectRatio: "3:4" });
    generatedImageUrl = imageUrl;
  } catch (err) {
    console.warn("[microstoreCurationAgent] Hero image generation failed:", err?.message);
  }

  const coverImageUrl = await selectStoreImage(generatedImageUrl, currentProducts, title, description, vibeOut);

  const styleNotesPayload = { text: styleNotes.find((n) => n.text)?.text || "", links: styleNotes.map((n) => ({ title: n.title || n.text || "Tip", url: n.url || "", type: (n.type || "text").toLowerCase(), description: n.description || n.text || "" })) };

  return {
    name: title,
    description,
    coverImageUrl: coverImageUrl ?? null,
    styleNotes: styleNotesPayload,
    sections: sectionsClean,
    vibe: vibeOut,
    trends: trendsOut,
    categories: categoriesOut,
  };
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

  const systemPrompt = `You are a fashion microstore curator. Given a store description, suggest a short catchy title and optionally polish the description.
Use these examples as reference (match tone and style):
${examplesText}

Output JSON only, no markdown, with keys: title, description, styleNotes, vibe, trends, categories.
- title: One short, catchy store name.
- description: One sentence (polish the user's description if needed).
- styleNotes: Array of 2 to ${STYLE_NOTES_COUNT} short style tips. Each item: { "text": "short tip" }.
- vibe: One vibe/occasion string.
- trends: Comma-separated trends.
- categories: Comma-separated categories.`;

  const userPrompt = `Store description: ${desc}
${vibe ? ` Vibe: ${vibe}.` : ""}${trend ? ` Trend: ${trend}.` : ""}${category ? ` Category: ${category}.` : ""}
Respond with JSON only.`;

  const llmOut = await complete(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { responseFormat: "json_object", maxTokens: 600 }
  );

  const title = llmOut.title || llmOut.name || "Curated Store";
  const descriptionOut = llmOut.description || desc;
  const vibeOut = llmOut.vibe || vibe || "";
  const trendsOut = llmOut.trends || trend || "";
  const categoriesOut = llmOut.categories || category || "";
  let styleNotes = llmOut.styleNotes;
  if (!Array.isArray(styleNotes) || styleNotes.length === 0) {
    styleNotes = [{ text: "Mix textures and fits for a modern look." }];
  }
  styleNotes = styleNotes.slice(0, STYLE_NOTES_COUNT).map((n) => (typeof n === "string" ? { text: n } : { text: n?.text || "Tip" }));

  const styleNotesPayload = {
    text: styleNotes.find((n) => n.text)?.text || "",
    links: styleNotes.map((n) => ({ title: n.text || "Tip", url: "", type: "text", description: n.text || "" })),
  };

  return {
    name: title,
    description: descriptionOut,
    styleNotes: styleNotesPayload,
    vibe: vibeOut,
    trends: trendsOut,
    categories: categoriesOut,
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
