/**
 * Get Ready With Me Agent
 * Powers the Get Ready flow: vibe options (time + profile), style tips, and "how do I look" evaluation.
 * Uses getUserProfile, getLatestStyleReport, and listLooks for context; LLM for personalization.
 */

import { getUserProfile, getLatestStyleReport } from "../domain/userProfile/userProfile.js";
import * as lookDomain from "../domain/looks/look.js";
import * as wardrobeDomain from "../domain/wardrobe/wardrobe.js";
import { searchProducts, listProducts } from "../domain/product/product.js";
import { complete } from "../utils/llm.js";
import { normalizeId } from "../core/helpers.js";
import { resolveImageUrlForExternal } from "../utils/storage.js";

const CONTEXT_MAX_CHARS = 600;
const DEFAULT_VIBE_OPTIONS = [
  "Office presentation",
  "Evening party",
  "Weekend brunch",
  "Smart casual",
  "Date night",
  "Travel",
  "Casual hangout",
  "Job interview",
];

/**
 * Build a short wardrobe summary for context (e.g. "Wardrobe: 5 items — Shirt, Pants, Dress, Jacket, Shoes").
 * @param {{ items: Array<{ category?: string | null }>, total?: number }} wardrobeResult
 * @returns {string}
 */
function buildWardrobeSummary(wardrobeResult) {
  if (!wardrobeResult?.items?.length) return "";
  const categories = [...new Set(wardrobeResult.items.map((i) => (i.category && String(i.category).trim()) || "Item").filter(Boolean))];
  const total = wardrobeResult.total ?? wardrobeResult.items.length;
  const list = categories.slice(0, 12).join(", ");
  return `Wardrobe: ${total} item${total !== 1 ? "s" : ""} — ${list}${categories.length > 12 ? "…" : ""}`;
}

function buildGetReadyContext(profile, looksResult, styleReportResult, wardrobeSummary = "") {
  const parts = [];
  if (profile?.summary?.sections) {
    const s = profile.summary.sections;
    if (s.styleProfile) parts.push(`Style: ${String(s.styleProfile).slice(0, 150)}`);
    if (s.fashionNeed) parts.push(`Focus: ${String(s.fashionNeed).slice(0, 100)}`);
  }
  if (profile?.personalInsight) parts.push(`Insight: ${String(profile.personalInsight).slice(0, 120)}`);
  if (looksResult?.items?.length) {
    const snippets = looksResult.items.slice(0, 3).map((l) => l.vibe || l.occasion || "").filter(Boolean);
    if (snippets.length) parts.push(`Recent looks: ${snippets.join(", ")}`);
  }
  if (styleReportResult?.reportData?.headline) {
    parts.push(`Style report: ${String(styleReportResult.reportData.headline).slice(0, 100)}`);
  }
  if (wardrobeSummary) parts.push(wardrobeSummary);
  const context = parts.join("\n");
  return context.length > CONTEXT_MAX_CHARS ? context.slice(0, CONTEXT_MAX_CHARS) + "…" : context;
}

/**
 * Get 6–10 vibe/occasion pills for "What are you dressing for?".
 * @param {string} userId
 * @param {{ timeOfDay?: string }} opts - timeOfDay: "morning" | "afternoon" | "evening" (optional)
 * @returns {Promise<{ options: string[] }>}
 */
export async function getVibeOptions(userId, opts = {}) {
  const uid = normalizeId(userId);
  if (!uid) throw new Error("userId required");

  const [profile, looksResult, styleReportResult, wardrobeResult] = await Promise.all([
    getUserProfile(uid),
    lookDomain.listLooks({ userId: uid, limit: 5, offset: 0 }),
    getLatestStyleReport(uid),
    wardrobeDomain.listWardrobe({ userId: uid, limit: 50 }),
  ]);

  const timeOfDay = opts.timeOfDay || (() => {
    const h = new Date().getHours();
    if (h < 12) return "morning";
    if (h < 17) return "afternoon";
    return "evening";
  })();

  const wardrobeSummary = buildWardrobeSummary(wardrobeResult);
  const context = buildGetReadyContext(profile, looksResult, styleReportResult, wardrobeSummary);
  if (!context.trim()) {
    return { options: DEFAULT_VIBE_OPTIONS };
  }

  try {
    const result = await complete(
      [
        {
          role: "system",
          content: `You are a fashion assistant. Given the user's style context and current time of day, suggest 6–10 short "occasion/vibe" labels for "What are you dressing for?".
Time of day: ${timeOfDay}. Prefer options relevant to this time and the user's profile.
Output JSON only: { "options": ["label1", "label2", ...] }. Each label 1–4 words, title case.`,
        },
        { role: "user", content: context },
      ],
      { responseFormat: "json_object", maxTokens: 300 }
    );
    const options = result?.options;
    if (Array.isArray(options) && options.length > 0) {
      return { options: options.slice(0, 10).map((o) => String(o).trim()).filter(Boolean) };
    }
  } catch (e) {
    console.warn("[getReadyAgent] getVibeOptions LLM failed:", e?.message);
  }
  return { options: DEFAULT_VIBE_OPTIONS };
}

/**
 * Get styling ideas and tips plus suggested products/looks.
 * @param {string} userId
 * @param {{ vibe?: string, mood?: string, outfitId?: string }} opts
 * @returns {Promise<{ tips: string[], suggestedProductsOrLooks: Array<{ id: string, title?: string, imageUrl?: string, type: 'product'|'look' }> }>}
 */
export async function getStyleTips(userId, opts = {}) {
  const uid = normalizeId(userId);
  if (!uid) throw new Error("userId required");

  const [profile, looksResult, styleReportResult, wardrobeResult] = await Promise.all([
    getUserProfile(uid),
    lookDomain.listLooks({ userId: uid, limit: 10, offset: 0 }),
    getLatestStyleReport(uid),
    wardrobeDomain.listWardrobe({ userId: uid, limit: 50 }),
  ]);

  const wardrobeSummary = buildWardrobeSummary(wardrobeResult);
  const context = buildGetReadyContext(profile, looksResult, styleReportResult, wardrobeSummary);
  const vibe = opts.vibe ? String(opts.vibe).trim() : "";
  const mood = opts.mood ? String(opts.mood).trim() : "";
  const outfitId = opts.outfitId ? String(opts.outfitId).trim() : "";

  const suggestedProductsOrLooks = [];
  if (looksResult?.items?.length) {
    looksResult.items.slice(0, 4).forEach((look) => {
      suggestedProductsOrLooks.push({
        id: look.id,
        title: look.vibe || look.occasion || "Look",
        imageUrl: look.imageUrl || undefined,
        type: "look",
      });
    });
  }

  let tips = [];
  const promptContext = [context, vibe && `Vibe/occasion: ${vibe}`, mood && `Mood: ${mood}`, outfitId && `Selected outfit/look id: ${outfitId}`].filter(Boolean).join("\n");

  try {
    const result = await complete(
      [
        {
          role: "system",
          content: `You are a personal stylist. Given the user's profile and (optionally) their chosen vibe and mood, give 2–3 short styling ideas or tips. Be specific and actionable.
Output JSON only: { "tips": ["tip one", "tip two", ...] }.`,
        },
        { role: "user", content: promptContext },
      ],
      { responseFormat: "json_object", maxTokens: 400 }
    );
    if (Array.isArray(result?.tips)) {
      tips = result.tips.slice(0, 5).map((t) => String(t).trim()).filter(Boolean);
    }
  } catch (e) {
    console.warn("[getReadyAgent] getStyleTips LLM failed:", e?.message);
    tips = ["Lean on pieces you feel confident in.", "Match formality to the occasion."];
  }

  return { tips, suggestedProductsOrLooks };
}

/**
 * Get outfit suggestions (suggested looks) from the product catalog using vibe, mood, and user profile.
 * Does not return fromWardrobe; the route merges that from style report / looks.
 * @param {string} userId
 * @param {{ vibe?: string, mood?: string, limit?: number, query?: string }} opts
 * @returns {Promise<{ suggestedLooks: Array<{ id: string, imageUrl: string | null, vibe: string | null, occasion: string | null, title: string }> }>}
 */
export async function getOutfitSuggestionsFromAgent(userId, opts = {}) {
  const uid = normalizeId(userId);
  if (!uid) throw new Error("userId required");

  const vibe = opts.vibe ? String(opts.vibe).trim() : "";
  const mood = opts.mood ? String(opts.mood).trim() : "";
  const limit = Math.min(20, Math.max(1, Number(opts.limit) || 12));
  const userQuery = opts.query ? String(opts.query).trim() : "";

  const [profile, looksResult, styleReportResult, wardrobeResult] = await Promise.all([
    getUserProfile(uid),
    lookDomain.listLooks({ userId: uid, limit: 3, offset: 0 }),
    getLatestStyleReport(uid),
    wardrobeDomain.listWardrobe({ userId: uid, limit: 50 }),
  ]);

  const wardrobeSummary = buildWardrobeSummary(wardrobeResult);
  const context = buildGetReadyContext(profile, looksResult, styleReportResult, wardrobeSummary);
  const promptInput = [
    context,
    vibe && `Vibe/occasion: ${vibe}`,
    mood && `Mood: ${mood}`,
    userQuery && `User wants more/different: ${userQuery}`,
  ].filter(Boolean).join("\n");

  let searchQuery = userQuery || vibe || "fashion outfit";
  if (promptInput.trim()) {
    try {
      const result = await complete(
        [
          {
            role: "system",
            content: `You are a fashion search assistant. Given the user's style context and their chosen vibe and mood, output a short product search query (2-6 words) to find clothing/outfit items that fit. Examples: "office blazer smart casual", "brunch summer dress", "minimal neutral sweater". Output JSON only: { "query": "your search query here" }.`,
          },
          { role: "user", content: promptInput },
        ],
        { responseFormat: "json_object", maxTokens: 80 }
      );
      if (result?.query && String(result.query).trim()) {
        searchQuery = String(result.query).trim();
      }
    } catch (e) {
      console.warn("[getReadyAgent] getOutfitSuggestionsFromAgent search query LLM failed:", e?.message);
    }
  }

  let products = [];
  try {
    const result = await searchProducts({
      query: searchQuery,
      limit,
      offset: 0,
    });
    products = result?.items || [];
  } catch (e) {
    console.warn("[getReadyAgent] searchProducts failed:", e?.message);
  }
  if (products.length === 0) {
    const listResult = await listProducts({ limit, offset: 0, status: "active" });
    products = listResult?.items || [];
  }

  const suggestedLooks = (products || []).map((p) => {
    const firstImage = p.images && p.images[0];
    const imageUrl = firstImage?.src ? String(firstImage.src).trim() : null;
    return {
      id: p.id,
      imageUrl: imageUrl || null,
      vibe: vibe || null,
      occasion: vibe || null,
      title: p.title || "Look",
    };
  });

  return { suggestedLooks };
}

/**
 * Evaluate "how do I look" from text and/or image; returns a short personalized response.
 * @param {string} userId
 * @param {{ text?: string, imageUrl?: string, vibe?: string }} opts
 * @returns {Promise<{ response: string }>}
 */
export async function evaluateHowDoILook(userId, opts = {}) {
  const uid = normalizeId(userId);
  if (!uid) throw new Error("userId required");

  const [profile, looksResult, styleReportResult] = await Promise.all([
    getUserProfile(uid),
    lookDomain.listLooks({ userId: uid, limit: 3, offset: 0 }),
    getLatestStyleReport(uid),
  ]);

  const context = buildGetReadyContext(profile, looksResult, styleReportResult);
  const vibe = opts.vibe ? String(opts.vibe).trim() : "";
  const text = opts.text ? String(opts.text).trim() : "";
  let imageUrl = opts.imageUrl ? String(opts.imageUrl).trim() : "";

  // Resolve to an absolute, fetchable URL for the vision API (e.g. OpenAI cannot fetch relative /uploads/...)
  if (imageUrl) {
    imageUrl = await resolveImageUrlForExternal(imageUrl);
    if (imageUrl && imageUrl.startsWith("/")) {
      const base = process.env.PUBLIC_API_URL || process.env.API_BASE_URL || "http://localhost:3002";
      imageUrl = base.replace(/\/$/, "") + imageUrl;
    }
  }

  const textContent = `User context:\n${context}\n${vibe ? `Their chosen vibe/occasion: ${vibe}\n` : ""}${text ? `Their message: ${text}` : ""}`.trim();
  const userContent = imageUrl
    ? [
        { type: "text", text: textContent + "\n[User attached a photo; comment on how their look fits their vibe and style.]" },
        { type: "image_url", image_url: { url: imageUrl } },
      ]
    : textContent;

  const messages = [
    {
      role: "system",
      content: `You are a supportive fashion advisor. When the user shares a photo, give encouraging but honest feedback in 2–4 sentences: praise what works and, if relevant, one gentle suggestion. Reference their vibe or occasion when possible; stay true to what you see. If they only send text, respond warmly or suggest uploading a photo for better feedback.`,
    },
    { role: "user", content: userContent },
  ];

  try {
    const response = await complete(messages, { maxTokens: 350 });
    const responseText = typeof response === "string" ? response.trim() : "";
    return { response: responseText || "You're looking great. Your style fits the moment—own it!" };
  } catch (e) {
    console.warn("[getReadyAgent] evaluateHowDoILook LLM failed:", e?.message);
    return { response: "You're looking great. Your style fits the moment—own it!" };
  }
}
