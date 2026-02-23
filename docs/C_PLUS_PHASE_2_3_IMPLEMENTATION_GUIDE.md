# C+ Phase 2 & 3: Preference Graph — Implementation Guide

This guide tells you **what to do** to implement the Preference Graph (Phase 2) and graph-based personalization (Phase 3). Phase 1 (fast load + diversity) and Phase 4 (frontend polish) are already done.

---

## Goal

- **Phase 2:** Build a **Preference Graph** per user: preferred brands, categories, vibes, occasions (from profile + wishlist + cart + follows + history), plus **complementary** category weights (e.g. Shirts → boost Trousers, Shoes, Accessories). Store it so the hot path does **one light read** instead of 6+ DB round-trips.
- **Phase 3:** Use the graph in **scoring**: when `personalized=1`, read the graph, then score products with **category caps** (e.g. max 30% from one category) and **complementary boosts** so the list is balanced (not only wishlisted categories).

---

## Phase 2: Preference Graph

### 2.1 Decide where to store the graph

**Option A — New table (recommended for clarity and indexing):**

- Add a `UserPreferenceGraph` (or `PreferenceGraph`) model in Prisma:
  - `userId` (unique), `preferredBrandIds` (Json array), `preferredCategories` (Json array), `preferredVibes` (Json), `preferredOccasions` (Json), `complementaryCategoryWeights` (Json, e.g. `{ "Shirts": { "Trousers": 0.8, "Shoes": 0.6 } }`), `updatedAt`.
- Run migration.

**Option B — JSON on UserProfile:**

- Add a column to `UserProfile`, e.g. `preferenceGraphJson` (Json), and `preferenceGraphUpdatedAt` (DateTime?). Same shape as the JSON in Option A. Fewer tables; all in one row.

### 2.2 Create the graph domain module

**New file: `backend2/src/domain/preferences/preferenceGraph.js`** (or `backend2/src/domain/personalization/preferenceGraph.js`).

Implement:

1. **`getPreferenceGraph(userId)`**
   - Returns the stored graph for the user (from `UserPreferenceGraph` or `UserProfile.preferenceGraphJson`). Return `null` if none; callers will fall back to current `getPersonalizationContext` if you want a gradual rollout.

2. **`buildPreferenceGraph(userId)`**
   - Inputs (all in one place):
     - **Profile:** `getUserProfile(userId)` → style profile (categories, vibes, occasions), need/motivation text.
     - **Wishlist:** `listWishlist(userId)` → product IDs → fetch product attributes (category_lvl1, mood_vibe, occasion_primary, brandId) for those products.
     - **Cart:** `listCartItems(userId)` → product IDs → same attribute fetch.
     - **Follows:** brand follows, microstore follows (for brand IDs).
     - **History:** last K `UserEvent` rows (e.g. product views, find_visit) → product IDs → same attribute fetch.
   - Aggregation:
     - Collect preferred **brandIds**, **category_lvl1**, **mood_vibe**, **occasion_primary** (count or weight by frequency).
   - Complementary rules:
     - Maintain a **static map** of “category → complementary categories with weights”, e.g.:
       - Shirts / Tops → Trousers, Jeans, Shoes, Accessories
       - Trousers → Shirts, Shoes, Accessories
       - Dresses → Shoes, Accessories
       - etc.
     - From preferred categories, derive **complementaryCategoryWeights** (which categories to boost and by how much).
   - Output: one object (e.g. `{ preferredBrandIds, preferredCategories, preferredVibes, preferredOccasions, complementaryCategoryWeights }`).
   - **Write** this to the DB (UserPreferenceGraph row or UserProfile.preferenceGraphJson + preferenceGraphUpdatedAt).

3. **Complementary rules (static config)**
   - Define a constant map, e.g. `COMPLEMENTARY_BY_CATEGORY`, in the same file or a small `complementaryRules.js`. Example shape:
     - `{ "Shirts": ["Trousers", "Shoes", "Accessories"], "Trousers": ["Shirts", "Shoes"], ... }`.
   - When building the graph, for each preferred category, add the complementary categories with a weight (e.g. 0.7 for “goes with”).

### 2.3 When to build / rebuild the graph (triggers)

- **On write paths (async preferred):**
  - After **wishlist** add/remove → call `buildPreferenceGraph(userId)` (fire-and-forget or queue).
  - After **cart** add/remove → same.
  - After **profile** update (style profile, quiz, need/motivation) → same.
  - After **follow** brand/microstore → same.
- **Periodic:** Optional cron (e.g. daily) that runs `buildPreferenceGraph` for active users (e.g. users with events in last 7 days).
- **Lazy:** Alternatively, on first `personalized=1` request, if graph is missing or older than TTL (e.g. 24h), call `buildPreferenceGraph` then use the new graph (adds latency once per user per TTL).

**Files to touch for triggers:**

- `backend2/src/domain/preferences/preferences.js` — after add/remove wishlist, call something like `invalidateOrBuildPreferenceGraph(userId)` (which can enqueue or call `buildPreferenceGraph`).
- `backend2/src/domain/cart/cart.js` — after add/remove cart item, same.
- `backend2/src/routes/profile.js` — after quiz submit (and optionally after profile generate-need-motivation), same.
- Brand/microstore follow routes — after follow/unfollow, same.

Keep triggers **non-blocking** (e.g. `void buildPreferenceGraph(userId).catch(...)`) so request latency doesn’t spike.

---

## Phase 3: Personalization uses graph

### 3.1 Use graph on the personalized path

In **`backend2/src/routes/products.js`**, when `personalized=1` and the user is authenticated:

1. Call **`getPreferenceGraph(userId)`** (single read).
2. If graph is **null** or too old (optional), fall back to current behavior: `getPersonalizationContext` + `scoreAndOrderProducts` (so existing behavior remains until graphs exist).
3. If graph is **present**, call a new scorer that uses only the graph (no full profile, no wishlist/cart/history reads on the hot path).

### 3.2 New scorer: `scoreAndOrderProductsWithGraph(products, graph, context?)`

**New (or extend) in `backend2/src/domain/personalization/personalization.js`:**

- **Input:** `products` (array), `graph` (object from `getPreferenceGraph`), optional `context` (e.g. listingType, searchQuery).
- **Scoring:**
  - **Preferred brands:** if `product.brandId` is in `graph.preferredBrandIds`, add a boost.
  - **Preferred categories / vibes / occasions:** match product’s `category_lvl1`, `mood_vibe`, `occasion_primary` to graph; add boost.
  - **Complementary boost:** if product’s category is in `graph.complementaryCategoryWeights` (as a key to boost), add a smaller boost so we surface “goes with” items.
- **Category caps:**
  - After scoring, you want to avoid the list being 80% one category. Options:
    - **Cap:** When building the ordered list, after sorting by score, apply a **round-robin or cap** so that no more than e.g. 30–40% of the first N items are from the same `category_lvl1`. You can do this by grouping by category and taking from each group in turn (similar to `diversifyOrderBrowse`) but using the graph’s preferred + complementary weights to order groups.
    - Or: **diversify after scoring** — sort by score, then run a diversity pass (e.g. `diversifyOrderBrowse`) so variety is enforced while still favoring high scores.
- **Output:** `{ ordered: Product[], scores: { id, score }[] }` (same shape as `scoreAndOrderProducts` for drop-in use).

### 3.3 Wire products route to graph

In **`backend2/src/routes/products.js`** (pseudocode):

```js
// When personalized=1 and req.userId:
const graph = await getPreferenceGraph(req.userId);
if (graph) {
  const { ordered } = await scoreAndOrderProductsWithGraph(items, graph, { listingType: 'products', search });
  items = ordered;
  res.setHeader("X-List-Order", "graph");
} else {
  // existing path
  const { ordered } = await scoreAndOrderProducts(req.userId, items, ...);
  items = ordered;
  res.setHeader("X-List-Order", "scored");
}
```

This gives you **Option C** over time: one request with graph-based personalization when the graph exists.

---

## Suggested order of implementation

| Step | What to do |
|------|------------|
| 1 | Add DB storage (Option A: new table + migration, or Option B: column on UserProfile). |
| 2 | Implement `getPreferenceGraph(userId)` and `buildPreferenceGraph(userId)` in `preferenceGraph.js`, with a static complementary map. |
| 3 | Add triggers: wishlist, cart, profile (quiz), follow — call `buildPreferenceGraph` async. |
| 4 | Implement `scoreAndOrderProductsWithGraph(products, graph, context)` with category caps and complementary boost. |
| 5 | In products route, when `personalized=1` and auth, try graph first; fallback to existing `scoreAndOrderProducts`. |
| 6 | (Optional) Cron or lazy build for users who never triggered a build. |
| 7 | Test: add to wishlist/cart, rebuild graph, call products with `personalized=1` and check order and variety. |

---

## Files to create or touch (summary)

| File | Action |
|------|--------|
| `prisma/schema.prisma` | Add `UserPreferenceGraph` model (or columns on `UserProfile`). |
| `prisma/migrations/...` | New migration. |
| `src/domain/preferences/preferenceGraph.js` | **New.** getPreferenceGraph, buildPreferenceGraph, complementary rules. |
| `src/domain/personalization/personalization.js` | Add `scoreAndOrderProductsWithGraph`; optionally export for use in products route. |
| `src/routes/products.js` | When personalized=1 and auth, use graph if present else existing scorer. |
| `src/domain/preferences/preferences.js` | After wishlist mutations, trigger graph build. |
| `src/domain/cart/cart.js` | After cart mutations, trigger graph build. |
| `src/routes/profile.js` | After quiz (and optionally need-motivation), trigger graph build. |
| Brand/microstore follow routes | After follow/unfollow, trigger graph build. |

---

## Testing

- **Unit:** `buildPreferenceGraph` with a test user that has wishlist + cart + profile; assert stored graph has expected preferred categories and complementary weights.
- **Integration:** GET `/api/products?limit=24&personalized=1` as that user; assert `X-List-Order: graph` and that the list has variety (not all one category) and reflects preferences.

---

## Risks and mitigations (from plan)

- **Stale graph:** Rebuild on key actions (wishlist, cart, profile, follow); optional TTL (e.g. 24h) or cron. For v1, “rebuild on write” is enough.
- **Complementary rules:** Start with a static config map; later you can derive from co-views or look composition.
- **Fallback:** If graph is missing, keep using current `getPersonalizationContext` + `scoreAndOrderProducts` so behavior is unchanged until graphs are built.

Once Phase 2 and 3 are in place, the personalized path becomes one graph read + listProducts + scoreAndOrderProductsWithGraph, which is faster and more balanced than the current 6+ round-trip context load.
