/**
 * Personalization Service (B5.3)
 *
 * Input: profile + context (listing type, search query, etc.).
 * Output: ordering/scores for products, microstores, brands; landing page choice.
 *
 * Used by listing APIs (B5.4) and landing page API to order results and choose which page to show.
 */

import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";
import { getUserProfile } from "../userProfile/userProfile.js";

/**
 * Normalize a string for matching: lowercased, trimmed, tokenized for "contains" checks.
 */
function norm(s) {
  if (s == null || typeof s !== "string") return "";
  return String(s).toLowerCase().trim();
}

/**
 * Tokenize comma/space-separated string into non-empty tokens.
 */
function tokens(s) {
  return norm(s)
    .split(/[\s,]+/)
    .filter(Boolean);
}

/**
 * Score 0..1 for text overlap (e.g. profile styleKeywords vs product mood_vibe).
 * Uses simple token overlap; if either side is empty, returns 0.
 */
function textMatchScore(profileTokens, entityValue) {
  if (!profileTokens || profileTokens.length === 0) return 0;
  const entityTokens = new Set(tokens(entityValue));
  if (entityTokens.size === 0) return 0;
  let hits = 0;
  for (const t of profileTokens) {
    if (entityTokens.has(t)) hits += 1;
    else {
      for (const et of entityTokens) {
        if (et.includes(t) || t.includes(et)) {
          hits += 0.5;
          break;
        }
      }
    }
  }
  return Math.min(1, hits / Math.max(1, profileTokens.length));
}

/**
 * Load personalization context for a user: profile snapshot + followed brand/microstore ids.
 * @param {string|null} userId
 * @returns {Promise<{ profile: Object|null, followedBrandIds: string[], followedMicrostoreIds: string[], recentProductIds: string[] }>}
 */
export async function getPersonalizationContext(userId) {
  const uid = normalizeId(userId);
  const prisma = getPrisma();

  let profile = null;
  let followedBrandIds = [];
  let followedMicrostoreIds = [];
  let recentProductIds = [];

  if (uid) {
    const [profileResult, brandFollows, microFollows, recentEvents] = await Promise.all([
      getUserProfile(uid),
      prisma.brandFollower.findMany({ where: { userId: uid }, select: { brandId: true } }),
      prisma.microStoreFollower.findMany({ where: { userId: uid }, select: { microStoreId: true } }),
      prisma.userEvent.findMany({
        where: { userId: uid, productId: { not: null } },
        orderBy: { timestamp: "desc" },
        take: 100,
        select: { productId: true },
      }),
    ]);
    profile = profileResult;
    followedBrandIds = (brandFollows || []).map((r) => r.brandId);
    followedMicrostoreIds = (microFollows || []).map((r) => r.microStoreId);
    const seen = new Set();
    recentProductIds = (recentEvents || [])
      .map((e) => e.productId)
      .filter(Boolean)
      .filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
  }

  return {
    profile,
    followedBrandIds,
    followedMicrostoreIds,
    recentProductIds,
  };
}

/**
 * Score and order products by profile match and recent engagement.
 * Products can be full DB rows or minimal { id, category_lvl1?, occasion_primary?, mood_vibe? }.
 * @param {string|null} userId
 * @param {Object[]} products - Array of products (each must have id; optional category_lvl1, occasion_primary, mood_vibe)
 * @param {Object} context - { listingType?, searchQuery? } (optional, for future use)
 * @returns {Promise<{ ordered: Object[], scores: { id: string, score: number }[] }>}
 */
export async function scoreAndOrderProducts(userId, products, context = {}) {
  const { profile, recentProductIds } = await getPersonalizationContext(userId);
  const style = profile?.styleProfile?.data ?? null;

  const profileKeywords = style?.styleKeywords && Array.isArray(style.styleKeywords)
    ? new Set(style.styleKeywords.map((k) => norm(k)))
    : new Set();
  const profileTokens = [...profileKeywords];
  const formality = norm(style?.formalityRange ?? "");
  const formalityTokens = tokens(formality);

  const scoreById = new Map();
  for (const p of products) {
    const id = p.id;
    if (!id) continue;
    let score = 0;

    if (profile) {
      const cat = norm(p.category_lvl1 ?? "");
      const occasion = norm(p.occasion_primary ?? "");
      const vibe = norm(p.mood_vibe ?? "");

      if (profileTokens.length > 0) {
        score += 0.4 * textMatchScore(profileTokens, p.mood_vibe ?? "");
        score += 0.3 * textMatchScore(profileTokens, p.category_lvl1 ?? "");
        score += 0.2 * textMatchScore(profileTokens, p.occasion_primary ?? "");
      }
      if (formalityTokens.length > 0 && (cat || occasion || vibe)) {
        score += 0.2 * (textMatchScore(formalityTokens, cat) + textMatchScore(formalityTokens, occasion)) / 2;
      }
      const recentIndex = recentProductIds.indexOf(id);
      if (recentIndex >= 0) {
        score += 0.5 * (1 - recentIndex / Math.max(1, recentProductIds.length));
      }
    }
    scoreById.set(id, Math.min(1, score));
  }

  const withScores = products
    .filter((p) => p.id)
    .map((p) => ({ item: p, score: scoreById.get(p.id) ?? 0 }))
    .sort((a, b) => b.score - a.score);

  return {
    ordered: withScores.map((x) => x.item),
    scores: withScores.map((x) => ({ id: x.item.id, score: x.score })),
  };
}

/**
 * Score and order microstores: followed first, then by vibe/categories match to profile.
 * @param {string|null} userId
 * @param {Object[]} microstores - Array with id, vibe?, categories?
 * @param {Object} context - { listingType?, searchQuery? }
 * @returns {Promise<{ ordered: Object[], scores: { id: string, score: number }[] }>}
 */
export async function scoreAndOrderMicrostores(userId, microstores, context = {}) {
  const { profile, followedMicrostoreIds } = await getPersonalizationContext(userId);
  const style = profile?.styleProfile?.data ?? null;
  const profileTokens = style?.styleKeywords && Array.isArray(style.styleKeywords)
    ? style.styleKeywords.map((k) => norm(k))
    : [];

  const scoreById = new Map();
  for (const m of microstores) {
    const id = m.id;
    if (!id) continue;
    let score = 0;
    const isFollowed = followedMicrostoreIds.includes(id);
    if (isFollowed) score += 2;
    if (profileTokens.length > 0) {
      score += 0.5 * textMatchScore(profileTokens, m.vibe ?? "");
      score += 0.3 * textMatchScore(profileTokens, m.categories ?? "");
    }
    scoreById.set(id, score);
  }

  const withScores = microstores
    .filter((m) => m.id)
    .map((m) => ({ item: m, score: scoreById.get(m.id) ?? 0 }))
    .sort((a, b) => b.score - a.score);

  return {
    ordered: withScores.map((x) => x.item),
    scores: withScores.map((x) => ({ id: x.item.id, score: x.score })),
  };
}

/**
 * Order brands: followed first, then original order (or by name).
 * @param {string|null} userId
 * @param {Object[]} brands - Array with id, name?
 * @param {Object} context - { listingType?, searchQuery? }
 * @returns {Promise<{ ordered: Object[], scores: { id: string, score: number }[] }>}
 */
export async function scoreAndOrderBrands(userId, brands, context = {}) {
  const { followedBrandIds } = await getPersonalizationContext(userId);

  const scoreById = new Map();
  for (const b of brands) {
    const id = b.id;
    if (!id) continue;
    scoreById.set(id, followedBrandIds.includes(id) ? 1 : 0);
  }

  const withScores = brands
    .filter((b) => b.id)
    .map((b) => ({ item: b, score: scoreById.get(b.id) ?? 0 }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const nameA = (a.item.name ?? "").toLowerCase();
      const nameB = (b.item.name ?? "").toLowerCase();
      return nameA.localeCompare(nameB);
    });

  return {
    ordered: withScores.map((x) => x.item),
    scores: withScores.map((x) => ({ id: x.item.id, score: x.score })),
  };
}

/** Landing page choices for getLandingPageChoice */
export const LANDING_PAGE_CHOICES = Object.freeze({
  STORE_FOR_YOU: "store_for_you",
  FEED: "feed",
  PRODUCTS: "products",
  DISCOVER: "discover",
});

/**
 * Choose which landing section to show for the user.
 * @param {string|null} userId
 * @param {Object} context - { listingType?, searchQuery?, hasFeedContent? } (optional)
 * @returns {Promise<{ choice: string, reason?: string }>}
 */
export async function getLandingPageChoice(userId, context = {}) {
  const { profile, followedBrandIds, followedMicrostoreIds } = await getPersonalizationContext(userId);
  const hasStyleProfile = Boolean(profile?.styleProfile?.data);
  const hasFollows = followedBrandIds.length > 0 || followedMicrostoreIds.length > 0;
  const hasFeedContent = context.hasFeedContent === true;

  if (hasStyleProfile && (hasFollows || hasFeedContent)) {
    return { choice: LANDING_PAGE_CHOICES.STORE_FOR_YOU, reason: "profile_and_engagement" };
  }
  if (hasFeedContent) {
    return { choice: LANDING_PAGE_CHOICES.FEED, reason: "feed_available" };
  }
  if (hasStyleProfile) {
    return { choice: LANDING_PAGE_CHOICES.PRODUCTS, reason: "profile_set" };
  }
  return { choice: LANDING_PAGE_CHOICES.DISCOVER, reason: "default" };
}
