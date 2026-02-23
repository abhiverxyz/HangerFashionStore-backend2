/**
 * Personalization Service (B5.3)
 *
 * Input: profile + context (listing type, search query, etc.).
 * Output: ordering/scores for products, microstores, brands; landing page choice.
 *
 * Used by listing APIs (B5.4) and landing page API to order results and choose which page to show.
 *
 * All personalization flows use getPersonalizationContext, which calls getUserProfile. Any new
 * "for you" or recommendations endpoint should use getPersonalizationContext or getUserProfile.
 */

import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";
import { getUserProfile } from "../userProfile/userProfile.js";
import { run as runUserProfileAgent } from "../../agents/userProfileAgent.js";

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
 * Extract preference tokens from user profile for matching products.
 * Uses styleKeywords, formalityRange, oneLiner, comprehensive fields; fallback to fashionNeed/fashionMotivation text.
 */
function extractProfileTokens(profile) {
  if (!profile) return [];
  const out = new Set();
  const style = profile.styleProfile?.data;
  if (style) {
    if (style.styleKeywords && Array.isArray(style.styleKeywords)) {
      for (const k of style.styleKeywords) if (norm(k)) out.add(norm(k));
    }
    if (style.formalityRange && norm(style.formalityRange)) {
      for (const t of tokens(style.formalityRange)) out.add(t);
    }
    if (style.oneLiner && norm(style.oneLiner)) {
      for (const t of tokens(style.oneLiner)) out.add(t);
    }
    const comp = style.comprehensive;
    if (comp?.style_dna?.keywords && Array.isArray(comp.style_dna.keywords)) {
      for (const k of comp.style_dna.keywords) if (norm(k)) out.add(norm(k));
    }
    if (comp?.synthesis?.style_keywords && Array.isArray(comp.synthesis.style_keywords)) {
      for (const k of comp.synthesis.style_keywords) if (norm(k)) out.add(norm(k));
    }
    if (comp?.synthesis?.style_descriptor_short && norm(comp.synthesis.style_descriptor_short)) {
      for (const t of tokens(comp.synthesis.style_descriptor_short)) out.add(t);
    }
    if (style.category_affinity && Array.isArray(style.category_affinity)) {
      for (const { category } of style.category_affinity) {
        if (category && norm(category)) out.add(norm(category));
      }
    }
  }
  if (out.size === 0 && profile.fashionNeed?.text && norm(profile.fashionNeed.text)) {
    for (const t of tokens(profile.fashionNeed.text)) out.add(t);
  }
  if (profile.fashionMotivation?.text && norm(profile.fashionMotivation.text)) {
    for (const t of tokens(profile.fashionMotivation.text)) out.add(t);
  }
  return [...out];
}

/**
 * Load personalization context for a user: profile snapshot + followed brand/microstore ids + find visit count.
 * @param {string|null} userId
 * @returns {Promise<{ profile: Object|null, followedBrandIds: string[], followedMicrostoreIds: string[], recentProductIds: string[], findVisitCount: number }>}
 */
export async function getPersonalizationContext(userId) {
  const uid = normalizeId(userId);
  const prisma = getPrisma();

  let profile = null;
  let followedBrandIds = [];
  let followedMicrostoreIds = [];
  let recentProductIds = [];
  let findVisitCount = 0;

  if (uid) {
    const [profileResult, brandFollows, microFollows, recentEvents, findVisitCountResult] = await Promise.all([
      getUserProfile(uid),
      prisma.brandFollower.findMany({ where: { userId: uid }, select: { brandId: true } }),
      prisma.microStoreFollower.findMany({ where: { userId: uid }, select: { microStoreId: true } }),
      prisma.userEvent.findMany({
        where: { userId: uid, productId: { not: null } },
        orderBy: { timestamp: "desc" },
        take: 100,
        select: { productId: true },
      }),
      prisma.userEvent.count({ where: { userId: uid, eventType: "find_visit" } }),
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
    findVisitCount = findVisitCountResult ?? 0;

    // Best-effort refresh: if need/motivation are missing or older than 24h, run User Profile Agent in background (fire-and-forget).
    const STALE_MS = 24 * 60 * 60 * 1000;
    const needUpdated = profile?.fashionNeed?.updatedAt ? new Date(profile.fashionNeed.updatedAt).getTime() : 0;
    const motivationUpdated = profile?.fashionMotivation?.updatedAt ? new Date(profile.fashionMotivation.updatedAt).getTime() : 0;
    const now = Date.now();
    const needMissingOrStale = !profile?.fashionNeed?.text || (needUpdated > 0 && now - needUpdated > STALE_MS);
    const motivationMissingOrStale = !profile?.fashionMotivation?.text || (motivationUpdated > 0 && now - motivationUpdated > STALE_MS);
    if (needMissingOrStale || motivationMissingOrStale) {
      void runUserProfileAgent({ userId: uid }).catch((err) => console.error("[personalization] background need-motivation refresh:", err?.message));
    }
  }

  return {
    profile,
    followedBrandIds,
    followedMicrostoreIds,
    recentProductIds,
    findVisitCount,
  };
}

const FIND_VISIT_REFRESH_INTERVAL = Number(process.env.FIND_VISIT_REFRESH_INTERVAL) || 5;
const FRESHNESS_WEIGHT = 0.12;
/** When user has a profile, keep freshness low so profile match and recent engagement drive order (not recency). */
const FRESHNESS_WEIGHT_WHEN_PROFILE = 0.04;
const PROFILE_MATCH_WEIGHT = 0.5;
const FORMALITY_WEIGHT = 0.15;
const RECENT_ENGAGEMENT_WEIGHT = 0.25;
const FOLLOWED_BRAND_BOOST = 0.3;
const POPULARITY_WEIGHT_DEFAULT = 0.25;
const ANONYMOUS_JITTER_WEIGHT = 0.4;

/**
 * Global engagement count per product (UserEvent with productId) for popularity scoring.
 * @param {string[]} productIds
 * @returns {Promise<Map<string, number>>}
 */
async function getGlobalProductEngagementCounts(productIds) {
  if (!productIds.length) return new Map();
  const prisma = getPrisma();
  const rows = await prisma.userEvent.groupBy({
    by: ["productId"],
    where: { productId: { in: productIds } },
    _count: { productId: true },
  });
  const map = new Map();
  for (const r of rows) {
    if (r.productId) map.set(r.productId, r._count.productId ?? 0);
  }
  return map;
}

/**
 * Grouping key for diversity: category + brand only (no product id). Ensures we interleave across categories and brands.
 */
function diversityGroupKey(item) {
  const cat = norm(item.category_lvl1 ?? "");
  const brand = norm(item.brandId ?? "");
  return (cat || "uncat") + "|" + (brand || "unbrand");
}

/**
 * Deterministic id hash 0..1 for mixing order when all products share one group.
 */
function idHash(id) {
  if (!id) return 0;
  const h = (id.split("").reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0) >>> 0) % 10000;
  return h / 10000;
}

/**
 * Diversity for browse: round-robin by (category, brand) so we see clear variety across products, categories, brands.
 * Group by diversityGroupKey (category|brand), sort each group by score desc, then take one from each group in turn.
 * When only one group (all same category+brand), sort by score + id hash so order is not pure updatedAt.
 * @param {{ item: Object, score: number }[]} withScores - Sorted by score desc
 * @returns {Object[]} Ordered items
 */
function diversifyOrderBrowse(withScores) {
  if (withScores.length === 0) return [];
  const byKey = new Map();
  for (const x of withScores) {
    const k = diversityGroupKey(x.item);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(x);
  }
  for (const arr of byKey.values()) {
    arr.sort((a, b) => b.score - a.score);
  }
  const keys = [...byKey.keys()];
  if (keys.length <= 1) {
    const mixed = [...withScores].sort(
      (a, b) => b.score + 0.35 * idHash(b.item.id) - (a.score + 0.35 * idHash(a.item.id))
    );
    return mixed.map((x) => x.item);
  }
  const ordered = [];
  let round = 0;
  while (ordered.length < withScores.length) {
    let took = false;
    for (const k of keys) {
      const group = byKey.get(k);
      if (!group || round >= group.length) continue;
      ordered.push(group[round].item);
      took = true;
      if (ordered.length === withScores.length) return ordered;
    }
    if (!took) break;
    round++;
  }
  return ordered;
}

/**
 * Diversity-only ordering (no profile, no scoring). Round-robin by (category_lvl1, brandId).
 * Use for fast first load when personalized=1 is not requested (C+ Phase 1).
 * @param {Object[]} items - Products with id, optional category_lvl1, brandId
 * @returns {Object[]} Same items reordered for variety
 */
export function orderByDiversityOnly(items) {
  if (!items || items.length === 0) return items;
  const byKey = new Map();
  for (const item of items) {
    const k = diversityGroupKey(item);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(item);
  }
  const keys = [...byKey.keys()];
  if (keys.length <= 1) return [...items];
  const ordered = [];
  let round = 0;
  while (ordered.length < items.length) {
    let took = false;
    for (const k of keys) {
      const group = byKey.get(k);
      if (!group || round >= group.length) continue;
      ordered.push(group[round]);
      took = true;
      if (ordered.length === items.length) return ordered;
    }
    if (!took) break;
    round++;
  }
  return ordered;
}

/** Weights for graph-based scoring (C+ Phase 3). */
const GRAPH_PREFERRED_BRAND_BOOST = 0.5;
const GRAPH_PREFERRED_CATEGORY_WEIGHT = 0.4;
const GRAPH_PREFERRED_VIBE_WEIGHT = 0.35;
const GRAPH_PREFERRED_OCCASION_WEIGHT = 0.35;
const GRAPH_COMPLEMENTARY_WEIGHT = 0.25;
const GRAPH_FRESHNESS_WEIGHT = 0.08;

/**
 * Score and order products using a pre-built preference graph only (no profile/context fetch).
 * Applies category diversity pass so the list is balanced (C+ Phase 3).
 * @param {Object[]} products - Products with id, category_lvl1, mood_vibe, occasion_primary, brandId, updatedAt
 * @param {Object} graph - From getPreferenceGraph: preferredBrandIds, preferredCategories, preferredVibes, preferredOccasions, complementaryCategoryWeights
 * @param {Object} context - { listingType? }
 * @returns {{ ordered: Object[], scores: { id: string, score: number }[] }}
 */
export function scoreAndOrderProductsWithGraph(products, graph, context = {}) {
  if (!graph || !products?.length) {
    return { ordered: [...(products || [])], scores: (products || []).map((p) => ({ id: p.id, score: 0 })) };
  }

  const preferredBrandIds = new Set(Array.isArray(graph.preferredBrandIds) ? graph.preferredBrandIds : []);
  const preferredCategories = graph.preferredCategories && typeof graph.preferredCategories === "object" ? graph.preferredCategories : {};
  const preferredVibes = graph.preferredVibes && typeof graph.preferredVibes === "object" ? graph.preferredVibes : {};
  const preferredOccasions = graph.preferredOccasions && typeof graph.preferredOccasions === "object" ? graph.preferredOccasions : {};
  const complementaryWeights = graph.complementaryCategoryWeights && typeof graph.complementaryCategoryWeights === "object" ? graph.complementaryCategoryWeights : {};

  const withUpdatedAt = products.filter((p) => p.id && p.updatedAt != null);
  const timestamps = withUpdatedAt.map((p) => (p.updatedAt instanceof Date ? p.updatedAt.getTime() : new Date(p.updatedAt).getTime()));
  const minTs = timestamps.length ? Math.min(...timestamps) : 0;
  const maxTs = timestamps.length ? Math.max(...timestamps) : 1;
  const freshnessRange = maxTs - minTs || 1;

  const scoreById = new Map();
  for (const p of products) {
    const id = p.id;
    if (!id) continue;
    let score = 0;

    const cat = norm(p.category_lvl1 ?? "");
    const vibe = norm(p.mood_vibe ?? "");
    const occ = norm(p.occasion_primary ?? "");

    if (p.brandId && preferredBrandIds.has(p.brandId)) {
      score += GRAPH_PREFERRED_BRAND_BOOST;
    }
    if (cat && preferredCategories[cat] != null) {
      score += GRAPH_PREFERRED_CATEGORY_WEIGHT * Math.min(1, (preferredCategories[cat] || 0) / 3);
    }
    if (vibe && preferredVibes[vibe] != null) {
      score += GRAPH_PREFERRED_VIBE_WEIGHT * Math.min(1, (preferredVibes[vibe] || 0) / 3);
    }
    if (occ && preferredOccasions[occ] != null) {
      score += GRAPH_PREFERRED_OCCASION_WEIGHT * Math.min(1, (preferredOccasions[occ] || 0) / 3);
    }
    if (cat && complementaryWeights[cat] != null) {
      score += GRAPH_COMPLEMENTARY_WEIGHT * Math.min(1, Number(complementaryWeights[cat]) || 0);
    }

    if (p.updatedAt != null) {
      const ts = p.updatedAt instanceof Date ? p.updatedAt.getTime() : new Date(p.updatedAt).getTime();
      score += GRAPH_FRESHNESS_WEIGHT * (ts - minTs) / freshnessRange;
    }

    scoreById.set(id, Math.min(3, score));
  }

  let withScores = products
    .filter((p) => p.id)
    .map((p) => ({ item: p, score: scoreById.get(p.id) ?? 0 }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return idHash(b.item.id) - idHash(a.item.id);
    });

  const ordered =
    context.listingType === "products" && withScores.length > 0
      ? diversifyOrderBrowse(withScores)
      : withScores.map((x) => x.item);

  const scoreMap = new Map(withScores.map((x) => [x.item.id, x.score]));
  return {
    ordered,
    scores: ordered.map((item) => ({ id: item.id, score: scoreMap.get(item.id) ?? 0 })),
  };
}

/**
 * Score and order products by profile match, freshness, preferences, and recent engagement.
 * Optionally applies diversity pass and visit-based refresh for listingType "products".
 * @param {string|null} userId
 * @param {Object[]} products - Array of products (each must have id; optional updatedAt, brandId, category_lvl1, occasion_primary, mood_vibe)
 * @param {Object} context - { listingType?, searchQuery?, findVisitCount? }
 * @returns {Promise<{ ordered: Object[], scores: { id: string, score: number }[] }>}
 */
export async function scoreAndOrderProducts(userId, products, context = {}) {
  const { profile, recentProductIds, followedBrandIds, findVisitCount = 0 } =
    await getPersonalizationContext(userId);
  const style = profile?.styleProfile?.data ?? null;
  const profileTokens = extractProfileTokens(profile);
  const formality = norm(style?.formalityRange ?? "");
  const formalityTokens = tokens(formality);

  const isBrowse = context.listingType === "products";
  const visitRefresh =
    isBrowse &&
    findVisitCount > 0 &&
    findVisitCount % FIND_VISIT_REFRESH_INTERVAL === 0;
  const hasProfile = profile != null && (profileTokens.length > 0 || formalityTokens.length > 0);
  const freshnessWeight =
    hasProfile
      ? (visitRefresh ? FRESHNESS_WEIGHT_WHEN_PROFILE * 1.5 : FRESHNESS_WEIGHT_WHEN_PROFILE)
      : (visitRefresh ? FRESHNESS_WEIGHT * 1.5 : FRESHNESS_WEIGHT);

  const withUpdatedAt = products.filter((p) => p.id && p.updatedAt != null);
  const timestamps = withUpdatedAt.map((p) => (p.updatedAt instanceof Date ? p.updatedAt.getTime() : new Date(p.updatedAt).getTime()));
  const minTs = timestamps.length ? Math.min(...timestamps) : 0;
  const maxTs = timestamps.length ? Math.max(...timestamps) : 1;
  const freshnessRange = maxTs - minTs || 1;

  let globalEngagement = new Map();
  if (!hasProfile && products.length > 0) {
    const ids = products.map((p) => p.id).filter(Boolean);
    globalEngagement = await getGlobalProductEngagementCounts(ids);
  }
  const maxEngagement = [...globalEngagement.values()].length
    ? Math.max(...[...globalEngagement.values()], 1)
    : 1;

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
        score += PROFILE_MATCH_WEIGHT * textMatchScore(profileTokens, p.mood_vibe ?? "");
        score += PROFILE_MATCH_WEIGHT * 0.7 * textMatchScore(profileTokens, p.category_lvl1 ?? "");
        score += PROFILE_MATCH_WEIGHT * 0.6 * textMatchScore(profileTokens, p.occasion_primary ?? "");
      }
      if (formalityTokens.length > 0 && (cat || occasion || vibe)) {
        score +=
          FORMALITY_WEIGHT *
          (textMatchScore(formalityTokens, cat) + textMatchScore(formalityTokens, occasion)) / 2;
      }
      const recentIndex = recentProductIds.indexOf(id);
      if (recentIndex >= 0) {
        score += RECENT_ENGAGEMENT_WEIGHT * (1 - recentIndex / Math.max(1, recentProductIds.length));
      }
    }

    if (p.updatedAt != null) {
      const ts = p.updatedAt instanceof Date ? p.updatedAt.getTime() : new Date(p.updatedAt).getTime();
      score += freshnessWeight * (ts - minTs) / freshnessRange;
    }
    if (followedBrandIds.length > 0 && p.brandId && followedBrandIds.includes(p.brandId)) {
      score += FOLLOWED_BRAND_BOOST;
    }

    if (!hasProfile && maxEngagement > 0) {
      const count = globalEngagement.get(id) ?? 0;
      score += POPULARITY_WEIGHT_DEFAULT * (count / maxEngagement);
    }

    if (!hasProfile) {
      const jitter = (id.split("").reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0) >>> 0) % 1000 / 1000;
      score += ANONYMOUS_JITTER_WEIGHT * jitter;
    }

    scoreById.set(id, Math.min(3, score));
  }

  let withScores = products
    .filter((p) => p.id)
    .map((p) => ({ item: p, score: scoreById.get(p.id) ?? 0 }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Break ties by id hash so order isn't just recency (original list order)
      return idHash(b.item.id) - idHash(a.item.id);
    });

  let ordered;
  if (isBrowse && withScores.length > 0) {
    ordered = diversifyOrderBrowse(withScores);
  } else {
    ordered = withScores.map((x) => x.item);
  }

  const scoreMap = new Map(withScores.map((x) => [x.item.id, x.score]));
  return {
    ordered,
    scores: ordered.map((item) => ({ id: item.id, score: scoreMap.get(item.id) ?? 0 })),
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
