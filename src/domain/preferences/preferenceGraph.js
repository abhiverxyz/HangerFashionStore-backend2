/**
 * C+ Phase 2: Preference Graph — build and read a per-user graph of preferred and complementary
 * brands, categories, vibes, occasions. Used for fast personalized product ordering (Phase 3).
 */

import { getPrisma } from "../../core/db.js";
import { normalizeId } from "../../core/helpers.js";
import { getUserProfile } from "../userProfile/userProfile.js";
import { setPreferenceGraph, getPreferenceGraphStored } from "../userProfile/userProfile.js";
import { listWishlist } from "./preferences.js";
import { listCartItems } from "../cart/cart.js";

function norm(s) {
  if (s == null || typeof s !== "string") return "";
  return String(s).toLowerCase().trim();
}

/** Static: for each category, which categories to boost (complementary). Weights applied in scoring. */
const COMPLEMENTARY_BY_CATEGORY = Object.freeze({
  shirts: ["trousers", "jeans", "shoes", "accessories"],
  tops: ["trousers", "jeans", "shoes", "accessories"],
  tshirts: ["trousers", "jeans", "shoes", "accessories"],
  trousers: ["shirts", "tops", "shoes", "accessories"],
  jeans: ["shirts", "tops", "shoes", "accessories"],
  pants: ["shirts", "tops", "shoes", "accessories"],
  dresses: ["shoes", "accessories"],
  skirts: ["shirts", "tops", "shoes", "accessories"],
  shoes: ["shirts", "trousers", "jeans", "accessories"],
  accessories: ["shirts", "trousers", "dresses"],
  outerwear: ["shirts", "trousers", "shoes"],
  knitwear: ["trousers", "jeans", "shoes"],
});

const RECENT_EVENTS_LIMIT = 100;
const COMPLEMENTARY_WEIGHT = 0.7;

/**
 * Get the stored preference graph for a user. Returns null if none or user invalid.
 * @param {string} userId
 * @returns {Promise<object | null>} Graph object or null
 */
export async function getPreferenceGraph(userId) {
  const uid = normalizeId(userId);
  if (!uid) return null;
  const stored = await getPreferenceGraphStored(uid);
  return stored?.graph ?? null;
}

/**
 * Aggregate preferred brands, categories, vibes, occasions from profile, wishlist, cart, follows, history.
 * Build complementary weights from preferred categories. Write graph to UserProfile.
 * @param {string} userId
 * @returns {Promise<object>} The built graph (same as stored)
 */
export async function buildPreferenceGraph(userId) {
  const uid = normalizeId(userId);
  if (!uid) throw new Error("userId required");
  const prisma = getPrisma();

  const [profile, wishlistResult, cartResult, brandFollows, microFollows, recentEvents] = await Promise.all([
    getUserProfile(uid),
    listWishlist(uid),
    listCartItems(uid),
    prisma.brandFollower.findMany({ where: { userId: uid }, select: { brandId: true } }),
    prisma.microStoreFollower.findMany({ where: { userId: uid }, select: { microStoreId: true } }),
    prisma.userEvent.findMany({
      where: { userId: uid, productId: { not: null } },
      orderBy: { timestamp: "desc" },
      take: RECENT_EVENTS_LIMIT,
      select: { productId: true },
    }),
  ]);

  const productIds = new Set();
  for (const w of wishlistResult?.items ?? []) {
    if (w?.productId) productIds.add(w.productId);
  }
  for (const c of cartResult?.items ?? []) {
    if (c?.productId) productIds.add(c.productId);
  }
  for (const e of recentEvents ?? []) {
    if (e?.productId) productIds.add(e.productId);
  }

  let productAttrs = [];
  if (productIds.size > 0) {
    productAttrs = await prisma.product.findMany({
      where: { id: { in: [...productIds] } },
      select: { category_lvl1: true, mood_vibe: true, occasion_primary: true, brandId: true },
    });
  }

  const preferredBrandIds = new Set();
  const preferredCategories = new Map(); // category -> count
  const preferredVibes = new Map();
  const preferredOccasions = new Map();

  for (const b of brandFollows ?? []) {
    if (b.brandId) preferredBrandIds.add(b.brandId);
  }

  for (const p of productAttrs) {
    const cat = norm(p.category_lvl1);
    if (cat) preferredCategories.set(cat, (preferredCategories.get(cat) || 0) + 1);
    const vibe = norm(p.mood_vibe);
    if (vibe) preferredVibes.set(vibe, (preferredVibes.get(vibe) || 0) + 1);
    const occ = norm(p.occasion_primary);
    if (occ) preferredOccasions.set(occ, (preferredOccasions.get(occ) || 0) + 1);
    if (p.brandId) preferredBrandIds.add(p.brandId);
  }

  // From profile style
  const style = profile?.styleProfile?.data;
  if (style) {
    if (style.styleKeywords && Array.isArray(style.styleKeywords)) {
      for (const k of style.styleKeywords) {
        const t = norm(k);
        if (t) preferredVibes.set(t, (preferredVibes.get(t) || 0) + 2);
      }
    }
    if (style.category_affinity && Array.isArray(style.category_affinity)) {
      for (const { category } of style.category_affinity) {
        const c = norm(category);
        if (c) preferredCategories.set(c, (preferredCategories.get(c) || 0) + 2);
      }
    }
  }
  if (profile?.fashionNeed?.text) {
    const tokens = norm(profile.fashionNeed.text).split(/\s+/).filter(Boolean);
    for (const t of tokens) if (t.length > 2) preferredVibes.set(t, (preferredVibes.get(t) || 0) + 1);
  }
  if (profile?.fashionMotivation?.text) {
    const tokens = norm(profile.fashionMotivation.text).split(/\s+/).filter(Boolean);
    for (const t of tokens) if (t.length > 2) preferredVibes.set(t, (preferredVibes.get(t) || 0) + 1);
  }

  // Complementary weights: for each preferred category, add complementary categories with weight
  const complementaryCategoryWeights = {};
  for (const [cat] of preferredCategories) {
    const comp = COMPLEMENTARY_BY_CATEGORY[cat];
    if (comp) {
      for (const c of comp) {
        complementaryCategoryWeights[c] = (complementaryCategoryWeights[c] || 0) + COMPLEMENTARY_WEIGHT;
      }
    }
  }

  const graph = {
    preferredBrandIds: [...preferredBrandIds],
    preferredCategories: Object.fromEntries(preferredCategories),
    preferredVibes: Object.fromEntries(preferredVibes),
    preferredOccasions: Object.fromEntries(preferredOccasions),
    complementaryCategoryWeights,
  };

  await setPreferenceGraph(uid, graph);
  return graph;
}

/**
 * Trigger a preference graph rebuild (fire-and-forget). Call after wishlist/cart/profile/follow changes.
 * @param {string} userId
 */
export function triggerBuildPreferenceGraph(userId) {
  const uid = normalizeId(userId);
  if (!uid) return;
  void buildPreferenceGraph(uid).catch((err) =>
    console.error("[preferenceGraph] buildPreferenceGraph failed:", err?.message)
  );
}
