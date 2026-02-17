/**
 * B7.4 Match Agent
 * Given user profile + wishlist/cart items, produces a "match to you" analysis per item (and optional summary).
 * Also produces recommended products outside wishlist/cart that match the user.
 * Uses LLM to assess how well products fit the user's style, need, and motivation.
 */

import { getUserProfile } from "../domain/userProfile/userProfile.js";
import { listWishlist } from "../domain/preferences/preferences.js";
import { listCartItems } from "../domain/cart/cart.js";
import { listProducts } from "../domain/product/product.js";
import { complete } from "../utils/llm.js";
import { normalizeId } from "../core/helpers.js";

const PROFILE_CONTEXT_MAX_CHARS = 1200;
const PRODUCT_DESC_MAX_CHARS = 200;
const LLM_MAX_TOKENS = 2000;
const MAX_ITEMS_FOR_ANALYSIS = 30;
const VALIDATE_COHERENCE_MAX_TOKENS = 200;
const VALIDATE_ITEMS_CAP = 10;

/**
 * Validate that the match analysis is coherent and fair (second LLM pass).
 * @param {string} profileContext - Short profile text used for the analysis
 * @param {string | null} summary - Overall summary from the analysis
 * @param {Array<{ productId: string, matchScore?: string, matchSummary?: string }>} items - Item-level matches
 * @returns {Promise<{ ok: boolean, reason: string | null } | null>} null on LLM/parse failure
 */
async function validateMatchAnalysisCoherence(profileContext, summary, items) {
  try {
    const profileSnippet = (profileContext || "").slice(0, 400);
    const summaryLine = (summary || "(no overall summary)").slice(0, 300);
    const itemLines = (items || [])
      .slice(0, VALIDATE_ITEMS_CAP)
      .map(
        (m) =>
          `- ${(m.productId || "").slice(0, 40)}: ${m.matchScore || "?"} — ${(m.matchSummary || "").slice(0, 80)}`
      )
      .join("\n");

    const prompt = `You are a quality checker for a fashion match analysis.

User profile (excerpt): ${profileSnippet}

Overall summary from the analysis: ${summaryLine}

Item-level matches (excerpt):
${itemLines}

Is this match analysis coherent (consistent with the profile and items) and fair (balanced, not biased)? Reply with JSON only: { "ok": boolean, "reason": string | null }. If not ok, reason should briefly explain.`;

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
      };
    }
  } catch (e) {
    console.warn("[matchAgent] validateMatchAnalysisCoherence failed:", e?.message);
  }
  return null;
}

/**
 * Run Match Agent: analyze wishlist items against user profile.
 * @param {Object} input - { userId: string }
 * @returns {Promise<{ items: Array<{ wishlistItemId, productId, matchSummary, matchScore }>, summary: string | null }>}
 */
export async function runMatchAnalysis(input) {
  const userId = input?.userId;
  const uid = normalizeId(userId);
  if (!uid) throw new Error("userId required");

  const [profile, wishlistResult] = await Promise.all([
    getUserProfile(uid),
    listWishlist(uid),
  ]);

  const items = wishlistResult?.items ?? [];
  if (items.length === 0) {
    return { items: [], summary: null };
  }

  const capped = items.slice(0, MAX_ITEMS_FOR_ANALYSIS);
  const profileContext = buildProfileContext(profile);
  const wishlistContext = buildWishlistContext(capped);

  let parsed = { itemMatches: [], summary: null };
  try {
    const result = await complete(
      [
        {
          role: "system",
          content: `You are a fashion stylist. Given a user's style profile and their wishlist items, analyze how well each item matches their style and needs.
Output a JSON object with:
- "itemMatches": array of objects, one per wishlist item in the same order as provided. Each object has:
  - "productId": string (exactly the productId from the input)
  - "matchSummary": string, 1-2 sentences: why this item fits (or doesn't quite fit) the user's style, occasion, or goals. Be specific and encouraging.
  - "matchScore": string, one of "high", "medium", "low" (how well it matches)
- "summary": string, optional 2-3 sentence overall take on their wishlist (e.g. "Your list leans casual and versatile—great for your profile." or "A few pieces could elevate your work looks.")
If the user has little or no profile, base match on the item's own attributes and give a neutral, helpful take.`,
        },
        {
          role: "user",
          content: `${profileContext}\n\n---\nWishlist items (analyze each in order):\n\n${wishlistContext}`,
        },
      ],
      { responseFormat: "json_object", maxTokens: LLM_MAX_TOKENS }
    );

    if (result && typeof result === "object") {
      if (Array.isArray(result.itemMatches)) parsed.itemMatches = result.itemMatches;
      if (typeof result.summary === "string" && result.summary.trim()) {
        parsed.summary = result.summary.trim().slice(0, 500);
      }
    }
  } catch (e) {
    console.warn("[matchAgent] LLM failed:", e?.message);
    return {
      items: capped.map((w) => ({
        wishlistItemId: w.id,
        productId: w.productId,
        matchSummary: null,
        matchScore: null,
      })),
      summary: null,
    };
  }

  const productIdToItem = new Map(capped.map((w) => [w.productId, w]));
  const matchesByProductId = new Map(
    parsed.itemMatches
      .filter((m) => m && typeof m.productId === "string")
      .map((m) => [m.productId, m])
  );

  const enriched = capped.map((w) => {
    const m = matchesByProductId.get(w.productId);
    return {
      wishlistItemId: w.id,
      productId: w.productId,
      matchSummary: m && typeof m.matchSummary === "string" ? m.matchSummary.trim() : null,
      matchScore: m && ["high", "medium", "low"].includes(m.matchScore) ? m.matchScore : null,
    };
  });

  let summaryOut = parsed.summary;
  const validation = await validateMatchAnalysisCoherence(
    profileContext,
    parsed.summary,
    parsed.itemMatches
  );
  if (validation && validation.ok === false && validation.reason) {
    summaryOut = (summaryOut || "").trim()
      ? `${summaryOut} (Review: ${validation.reason})`
      : `(Review: ${validation.reason})`;
  }

  return {
    items: enriched,
    summary: summaryOut || null,
  };
}

function buildProfileContext(profile) {
  const parts = ["User profile (use for match analysis):"];

  const styleData = profile?.styleProfile?.data;
  if (styleData != null) {
    const raw = typeof styleData === "string" ? styleData : JSON.stringify(styleData);
    parts.push(`Style: ${raw.slice(0, PROFILE_CONTEXT_MAX_CHARS)}${raw.length > PROFILE_CONTEXT_MAX_CHARS ? "…" : ""}`);
  } else {
    parts.push("Style: (no style profile yet)");
  }

  const need = profile?.fashionNeed?.text;
  if (need && need.trim()) parts.push(`Current need: ${need.trim()}`);
  const motivation = profile?.fashionMotivation?.text;
  if (motivation && motivation.trim()) parts.push(`Motivation: ${motivation.trim()}`);

  return parts.join("\n");
}

function buildWishlistContext(items) {
  return buildProductListContext(items, (w) => w.product, (w) => w.productId);
}

function buildCartContext(items) {
  return buildProductListContext(items, (c) => c.product, (c) => c.productId);
}

function buildProductListContext(items, getProduct, getProductId) {
  return items
    .map((item, i) => {
      const p = getProduct(item);
      const pid = getProductId(item);
      if (!p) return `${i + 1}. productId: ${pid} (no details)`;
      const attrs = [
        p.title,
        p.brand?.name && `Brand: ${p.brand.name}`,
        p.product_type,
        p.category_lvl1 || p.category_lvl2,
        p.color_primary,
        p.style_family,
        p.mood_vibe,
      ].filter(Boolean);
      const desc = attrs.join(" · ").slice(0, PRODUCT_DESC_MAX_CHARS);
      return `${i + 1}. productId: ${p.id}\n   ${desc}`;
    })
    .join("\n\n");
}

/**
 * Run Match Agent for cart items (same logic as wishlist, different source).
 * @param {Object} input - { userId: string }
 * @returns {Promise<{ items: Array<{ cartItemId, productId, matchSummary, matchScore }>, summary: string | null }>}
 */
export async function runMatchAnalysisForCart(input) {
  const userId = input?.userId;
  const uid = normalizeId(userId);
  if (!uid) throw new Error("userId required");

  const [profile, cartResult] = await Promise.all([
    getUserProfile(uid),
    listCartItems(uid),
  ]);

  const items = cartResult?.items ?? [];
  if (items.length === 0) return { items: [], summary: null };

  const capped = items.slice(0, MAX_ITEMS_FOR_ANALYSIS);
  const profileContext = buildProfileContext(profile);
  const cartContext = buildCartContext(capped);

  let parsed = { itemMatches: [], summary: null };
  try {
    const result = await complete(
      [
        {
          role: "system",
          content: `You are a fashion stylist. Given a user's style profile and their cart items, analyze how well each item matches their style and needs.
Output a JSON object with:
- "itemMatches": array of objects, one per cart item in the same order as provided. Each object has:
  - "productId": string (exactly the productId from the input)
  - "matchSummary": string, 1-2 sentences: why this item fits (or doesn't quite fit) the user's style, occasion, or goals. Be specific and encouraging.
  - "matchScore": string, one of "high", "medium", "low" (how well it matches)
- "summary": string, optional 2-3 sentence overall take on their cart (e.g. "Your cart has a cohesive vibe." or "A couple of pieces could round out your look.")
If the user has little or no profile, base match on the item's own attributes and give a neutral, helpful take.`,
        },
        {
          role: "user",
          content: `${profileContext}\n\n---\nCart items (analyze each in order):\n\n${cartContext}`,
        },
      ],
      { responseFormat: "json_object", maxTokens: LLM_MAX_TOKENS }
    );

    if (result && typeof result === "object") {
      if (Array.isArray(result.itemMatches)) parsed.itemMatches = result.itemMatches;
      if (typeof result.summary === "string" && result.summary.trim()) {
        parsed.summary = result.summary.trim().slice(0, 500);
      }
    }
  } catch (e) {
    console.warn("[matchAgent] cart LLM failed:", e?.message);
    return {
      items: capped.map((c) => ({
        cartItemId: c.id,
        productId: c.productId,
        matchSummary: null,
        matchScore: null,
      })),
      summary: null,
    };
  }

  const matchesByProductId = new Map(
    parsed.itemMatches
      .filter((m) => m && typeof m.productId === "string")
      .map((m) => [m.productId, m])
  );

  const enriched = capped.map((c) => {
    const m = matchesByProductId.get(c.productId);
    return {
      cartItemId: c.id,
      productId: c.productId,
      matchSummary: m && typeof m.matchSummary === "string" ? m.matchSummary.trim() : null,
      matchScore: m && ["high", "medium", "low"].includes(m.matchScore) ? m.matchScore : null,
    };
  });

  let summaryOut = parsed.summary;
  const validation = await validateMatchAnalysisCoherence(
    profileContext,
    parsed.summary,
    parsed.itemMatches
  );
  if (validation && validation.ok === false && validation.reason) {
    summaryOut = (summaryOut || "").trim()
      ? `${summaryOut} (Review: ${validation.reason})`
      : `(Review: ${validation.reason})`;
  }

  return { items: enriched, summary: summaryOut || null };
}

/** Max products to consider for "match for you" recommendations. */
const MAX_CANDIDATES_FOR_RECOMMENDATIONS = 80;
/** Default number of recommended products to return. */
const DEFAULT_RECOMMENDATION_LIMIT = 12;

/**
 * Run Match Agent for recommendations: products outside wishlist and cart that match the user.
 * @param {Object} input - { userId: string, limit?: number }
 * @returns {Promise<{ items: Array<{ product, matchSummary, matchScore }>, summary: string | null }>}
 */
export async function runMatchRecommendations(input) {
  const userId = input?.userId;
  const limit = Math.min(24, Math.max(1, Number(input?.limit) || DEFAULT_RECOMMENDATION_LIMIT));
  const uid = normalizeId(userId);
  if (!uid) throw new Error("userId required");

  const [profile, wishlistResult, cartResult, productsResult] = await Promise.all([
    getUserProfile(uid),
    listWishlist(uid),
    listCartItems(uid),
    listProducts({
      status: "active",
      limit: MAX_CANDIDATES_FOR_RECOMMENDATIONS,
      offset: 0,
    }),
  ]);

  const excludeIds = new Set([
    ...(wishlistResult?.items ?? []).map((w) => w.productId),
    ...(cartResult?.items ?? []).map((c) => c.productId),
  ]);

  const candidates = (productsResult?.items ?? []).filter((p) => !excludeIds.has(p.id));
  if (candidates.length === 0) return { items: [], summary: null };

  const capped = candidates.slice(0, MAX_ITEMS_FOR_ANALYSIS);
  const profileContext = buildProfileContext(profile);
  const productListContext = capped
    .map((p, i) => {
      const attrs = [
        p.title,
        p.brand?.name && `Brand: ${p.brand.name}`,
        p.product_type,
        p.category_lvl1 || p.category_lvl2,
        p.color_primary,
        p.style_family,
        p.mood_vibe,
      ].filter(Boolean);
      const desc = attrs.join(" · ").slice(0, PRODUCT_DESC_MAX_CHARS);
      return `${i + 1}. productId: ${p.id}\n   ${desc}`;
    })
    .join("\n\n");

  let parsed = { recommendations: [], summary: null };
  try {
    const result = await complete(
      [
        {
          role: "system",
          content: `You are a fashion stylist. Given a user's style profile and a list of products (NOT in their wishlist or cart), pick the top ${limit} products that best match their style and needs. Return ONLY those, in descending order of match.
Output a JSON object with:
- "recommendations": array of objects, one per selected product (max ${limit}). Each object has:
  - "productId": string (exactly from the input)
  - "matchSummary": string, 1-2 sentences: why this product is a great match for them. Be specific and encouraging.
  - "matchScore": string, one of "high", "medium" (all recommended should be at least medium)
- "summary": string, optional 1-2 sentence intro for this "match for you" set (e.g. "These pieces fit your versatile, smart-casual style.")
Pick products that genuinely fit. If none fit well, return fewer items. If the user has little profile, pick versatile, on-trend pieces.`,
        },
        {
          role: "user",
          content: `${profileContext}\n\n---\nCandidate products (pick top ${limit} that match the user):\n\n${productListContext}`,
        },
      ],
      { responseFormat: "json_object", maxTokens: LLM_MAX_TOKENS }
    );

    if (result && typeof result === "object") {
      if (Array.isArray(result.recommendations)) parsed.recommendations = result.recommendations;
      if (typeof result.summary === "string" && result.summary.trim()) {
        parsed.summary = result.summary.trim().slice(0, 500);
      }
    }
  } catch (e) {
    console.warn("[matchAgent] recommendations LLM failed:", e?.message);
    return { items: [], summary: null };
  }

  const productById = new Map(capped.map((p) => [p.id, p]));
  const recByProductId = new Map(
    parsed.recommendations
      .filter((r) => r && typeof r.productId === "string")
      .map((r) => [r.productId, r])
  );

  const items = [];
  for (const r of parsed.recommendations) {
    const product = productById.get(r.productId);
    if (!product) continue;
    items.push({
      product,
      matchSummary:
        r && typeof r.matchSummary === "string" ? r.matchSummary.trim() : null,
      matchScore:
        r && ["high", "medium", "low"].includes(r.matchScore) ? r.matchScore : "medium",
    });
  }

  let summaryOut = parsed.summary;
  const validation = await validateMatchAnalysisCoherence(
    profileContext,
    parsed.summary,
    parsed.recommendations
  );
  if (validation && validation.ok === false && validation.reason) {
    summaryOut = (summaryOut || "").trim()
      ? `${summaryOut} (Review: ${validation.reason})`
      : `(Review: ${validation.reason})`;
  }

  return {
    items,
    summary: summaryOut || null,
  };
}
