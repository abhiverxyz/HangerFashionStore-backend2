import { Router } from "express";
import { asyncHandler } from "../core/asyncHandler.js";
import { searchProducts } from "../domain/product/product.js";
import { searchMicrostores, parseSections } from "../domain/microstore/microstore.js";
import { searchBrands } from "../domain/brand/brand.js";
import { scoreAndOrderProducts } from "../domain/personalization/personalization.js";
import { getUserProfile } from "../domain/userProfile/userProfile.js";
import { resolveImageUrlForExternal } from "../utils/storage.js";
import { optionalAuth } from "../middleware/requireAuth.js";

const router = Router();

/**
 * POST /api/search — natural language or image-based product search (B3.4). D.7: refinements.
 * Body: { query?, imageUrl?, limit?, offset?, brandId?, category_lvl1?, occasion_primary?, mood_vibe?, includeMicrostores?, includeBrands? }
 * Returns: { items, total, microstores?, brands? } — optional microstores/brands when include* true.
 */
router.post(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { query, imageUrl, limit, offset, brandId, category_lvl1, occasion_primary, mood_vibe, includeMicrostores, includeBrands } = req.body ?? {};
    const resolvedImageUrl =
      imageUrl != null && String(imageUrl).trim()
        ? await resolveImageUrlForExternal(String(imageUrl).trim())
        : undefined;
    let searchQuery = typeof query === "string" ? query.trim() : "";
    if (req.userId && searchQuery) {
      try {
        const profile = await getUserProfile(req.userId);
        const style = profile?.styleProfile?.data;
        const keywords =
          style?.styleKeywords && Array.isArray(style.styleKeywords)
            ? style.styleKeywords.slice(0, 2).filter((k) => k && String(k).trim())
            : [];
        if (keywords.length > 0) {
          searchQuery = [searchQuery, ...keywords].join(" ").trim();
        }
      } catch {
        // ignore profile fetch failure
      }
    }
    const result = await searchProducts({
      query: searchQuery || undefined,
      imageUrl: resolvedImageUrl,
      limit,
      offset,
      brandId,
      category_lvl1,
      occasion_primary,
      mood_vibe,
    });
    if (req.userId && result.items && result.items.length > 0) {
      const { ordered } = await scoreAndOrderProducts(req.userId, result.items, {
        listingType: "search",
        searchQuery,
      });
      result.items = ordered;
    }
    result.items = (result.items || []).map((p) => ({
      ...p,
      price: p.variants?.[0]?.price != null ? `₹${p.variants[0].price}` : null,
    }));
    const q = typeof query === "string" ? query.trim() : "";
    if (includeMicrostores && q) {
      const ms = await searchMicrostores(q, { userId: req.userId ?? null, limit: 10 });
      result.microstores = {
        items: ms.items.map((s) => ({
          ...s,
          sections: parseSections(s.sections),
          followerCount: s._count?.followers ?? 0,
        })),
      };
    } else if (includeMicrostores) {
      result.microstores = { items: [] };
    }
    if (includeBrands && q) {
      const br = await searchBrands(q, { limit: 10 });
      result.brands = { items: br.items.map((b) => ({ ...b, followerCount: b._count?.followers ?? 0 })) };
    } else if (includeBrands) {
      result.brands = { items: [] };
    }
    res.json(result);
  })
);

/**
 * GET /api/search/microstores?q=&limit= — text search microstores by name/description (B6). Respects visibility.
 */
router.get(
  "/microstores",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { q, query, limit } = req.query;
    const searchQuery = (q || query || "").trim();
    const result = await searchMicrostores(searchQuery, {
      userId: req.userId ?? null,
      limit: limit ? Number(limit) : 20,
    });
    const items = result.items.map((s) => ({
      ...s,
      sections: parseSections(s.sections),
      followerCount: s._count?.followers ?? 0,
    }));
    res.json({ items });
  })
);

/**
 * GET /api/search/brands?q=&limit= — text search brands by name/description (B7).
 */
router.get(
  "/brands",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { q, query, limit } = req.query;
    const searchQuery = (q || query || "").trim();
    const result = await searchBrands(searchQuery, { limit: limit ? Number(limit) : 20 });
    const items = result.items.map((b) => ({ ...b, followerCount: b._count?.followers ?? 0 }));
    res.json({ items });
  })
);

export default router;
