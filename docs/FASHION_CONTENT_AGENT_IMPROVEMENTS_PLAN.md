# Fashion Content Agent: improvement plan

This plan addresses the gaps between current implementation and intent, plus the issue that all trends end up as parents (no hierarchy) due to missing post-generation validation and family reclubbing.

---

## Problem summary

| # | Problem | Impact |
|---|---------|--------|
| 1 | **All trends are parent** — LLM often omits or inconsistently sets `familyName`; no post-generation step to infer or fix hierarchy | Flat list; no parent/child structure in UI or for downstream agents |
| 2 | **No validation** — Plan says "validate: relevance, quality, current enough; filter noise" but output is written as-is | Low-quality or off-topic trends/rules persist |
| 3 | **Web use fragile** — URLs depend on LLM suggesting allowlisted URLs; no fallback for key domains | Empty web context when LLM doesn’t return the right shape or domains |
| 4 | **Rule hierarchy brittle** — Parent resolved by title only; titles not unique | Wrong or inconsistent rule trees |
| 5 | **Trend "created" overcounted** — Every upsert counted as created; no created vs updated | Misleading metrics |
| 6 | **Parent trends are placeholders** — Parents get `description: "Family: X"` only; no real description/impactedItemTypes/tellTaleSigns | Weak parent content for downstream use |
| 7 | **Pruning ignores recency/relevance** — By strength then age only | Can remove strong, relevant content |
| 8 | **Admin "comment only"** — No way to mark input as comment-only; everything can become trend/rule | Unwanted trends/rules from notes |
| 9 | **Rule dedup windowed** — Only last 500 rules checked for body match | Duplicates possible |
| 10 | **No provenance** — No record of which run/source produced or last updated an item | Hard to audit or debug |

---

## 1. Post-generation validation and reclubbing (fix “all parents”)

**Goal:** Ensure we get real parent/child trend hierarchy instead of a flat list of parents.

### 1.1 Reclubbing (infer families when LLM omits familyName)

- **After** the LLM returns `rawTrends`, **before** writing:
  - **Option A — LLM reclub:** One small LLM call: "Given these trends (name, description, keywords, category), group them into families. Return JSON: { families: [ { parentName, childNames: [] } ] }. A trend can be parent only, or child of one parent. Use semantic similarity (e.g. Minimal Knits under Quiet Luxury)." Then merge with rawTrends: for each trend, if it appears in childNames, set familyName = parentName.
  - **Option B — Keyword/category overlap:** Without a second LLM call: group trends by shared category or by keyword overlap (e.g. Jaccard on keyword sets). Pick the strongest trend in each group as synthetic parent (or use first as parent name), assign others as children. Less accurate but no extra token cost.
- **Recommendation:** Start with Option A (LLM reclub) so we get semantic families; fallback to Option B if we want to avoid a second call or reduce cost.

### 1.2 Validation (quality and required fields)

- **After** generation (and after reclubbing if applied):
  - **Trends:** Drop or flag trends with empty/missing `trendName` or very short `description`; clamp strength 1–10; normalize familyName to match an existing parent name (case-insensitive) when writing.
  - **Rules:** Drop rules with empty `body`; clamp strength; optionally flag very short body.
  - **Deduplication:** For trends, we already upsert by (trendName, parentId). For rules, consider checking body against all rules (or a larger window) if we want fewer duplicates.
- **Output:** Validated lists only are passed to the write step; optionally log dropped count in results.

### 1.3 Enforce parent creation from child references

- When building `familyDisplayName`, include not only explicit `familyName` from the LLM but also any parent names that appear in the reclubbing output. Ensure we create a parent row for every family key we intend to use before writing children.
- When writing a trend with `familyName`, if `parentIdByFamily[familyKey(fn)]` is missing (e.g. reclub assigned a new family), create that parent first, then write the child.

---

## 2. Validation step (relevance, quality, filter noise)

- **Insert** a dedicated validation step between "Generate" and "Write":
  - **Schema/required:** Ensure each trend has trendName, description (min length); each rule has body (min length); strengths in 1–10.
  - **Quality (optional):** Optional second LLM call: "Rate each trend 1–5 for relevance and quality; return scores." Filter out trends below a threshold (e.g. 2) or flag them. Can be phased in later to control cost.
  - **Noise filter:** Drop trends/rules that are too generic (e.g. description is a single word) or duplicate (same trendName + same parentId already in batch). 
- **Result:** Only validated items are written; `results.droppedTrends` / `results.droppedRules` can be added for visibility.

---

## 3. Web use (reliable allowlist usage)

- **Fallback URLs:** If allowlist is non-empty but `llmSuggestUrls()` returns empty or no URL passes the allowlist filter, optionally use a **curated fallback** list (e.g. 2–3 known-good URLs per allowlist domain) from config or env, and fetch those. Ensures at least some web content when the LLM fails to suggest allowlisted URLs.
- **Structured LLM response:** Tighten the prompt and parsing so we accept only a JSON object with key `urls` (array of strings). If the model returns another shape, try to parse array from common keys (already partially done) and log a warning.
- **Document:** In admin UI or docs, state that "Agent fetches only from allowlist; add vogue.com, whowhatwear.com, etc. If no URLs are fetched, check allowlist and run again or add fallback URLs."

---

## 4. Rule hierarchy (more stable)

- **Short term:** Keep parent by title but document that rule titles should be unique for hierarchy to be reliable; optionally in admin UI show a warning when multiple rules share the same title.
- **Medium term:** Add optional `parentId` to the LLM output for rules (e.g. "if this rule is child of an existing rule, you may reference by rule title; we resolve to id"). When we have a previous run, we could pass existing rule titles and ids to the LLM so it can output parentId directly for children (if we want to move to id-based hierarchy).
- **Alternative:** When writing a rule with `parentTitle`, resolve to the **most recently updated** rule with that title (already the case with findFirst orderBy updatedAt desc) and document that behavior.

---

## 5. Accurate created vs updated counts

- **Trends:** In `upsertTrend`, return a flag or check: e.g. for root path use `findFirst`; if existing, call `update` and count as updated; if not, `create` and count as created. For child path use `upsert` and infer from Prisma (e.g. try to use a raw query or Prisma’s behavior: upsert returns the record but doesn’t tell you if it was create or update). **Practical approach:** Before upsert, do a findFirst/findUnique; if found, update and increment `trendsUpdated`; else create and increment `trendsCreated`. Same for rules: we already have “existing” when we match by body — we count rulesUpdated vs rulesCreated; ensure every write path sets one or the other.
- **Results:** Expose `trendsCreated`, `trendsUpdated`, `rulesCreated`, `rulesUpdated` correctly in the run result and in the admin UI.

---

## 6. Parent trends get real content

- **Prompt:** In the main generate prompt, state that "Parent trends (root/family trends) must also have a clear description, keywords, category, and optionally impactedItemTypes and tellTaleSigns. Do not use a placeholder like 'Family: X' for parent descriptions."
- **Write step:** When creating/updating a **parent** trend row (the first pass over family names), if the LLM also returned a trend with the same name as the family (trendName === familyName), use that trend’s description, keywords, category, strength, impactedItemTypes, tellTaleSigns for the parent row instead of "Family: {name}". So merge parent row with the matching trend from rawTrends when present.

---

## 7. Pruning (recency and relevance)

- **Option A:** Prune by a composite score, e.g. `strength * 2 + recencyScore` where recencyScore is 0–1 based on updatedAt (newer = higher). Delete lowest composite first.
- **Option B:** Prune only trends/rules not updated in the last N runs or M days (requires storing lastRunId or updatedAt and a cutoff). So we remove only "stale" weak items.
- **Recommendation:** Start with Option A (composite of strength + recency) so we keep strong and recent; document in code and in run result how many were pruned and why (e.g. "pruned by strength+recency").

---

## 8. Admin “comment only”

- **Schema (optional):** Add a field on FashionContentSource, e.g. `interpretAs: "auto" | "trends_and_rules" | "comment_only"`. Default "auto". When "comment_only", agent still processes the source (for context) but does not add new trends/rules from it; or we skip adding to the combined context for generation and only use it in a separate "admin notes" store.
- **Simpler approach:** In the prompt, add: "If the admin input is clearly only a comment or note (e.g. 'Remember to focus on winter'), do not create new trends or styling rules from it." So we rely on the LLM to not emit trends/rules for comment-only input. Optionally add a post-validation step: if the only new items in the batch came from a source that looks like a single-line comment, drop those items.

---

## 9. Rule deduplication (global or larger window)

- **Option A:** Increase window from 500 to 2000 or 5000 (bounded by DB size).
- **Option B:** Add a unique constraint or index on normalized body (e.g. add column `bodyNormalized` or hash) and do findFirst by that; then we effectively have global dedup. Requires migration.
- **Recommendation:** Short term increase to 2000; if duplicates still appear, add bodyNormalized/hash and use it for lookup (phase 2).

---

## 10. Provenance (optional / phase 2)

- Add optional fields: `lastRunId` (string, e.g. timestamp or run id) and/or `sourceType: "admin" | "web" | "llm"` on Trend and StylingRule. Populate on write. Enables "last updated by run X" and filtering by source. Requires schema change and migration; can be deferred.

---

## Implementation order

| Phase | Items | Notes |
|-------|--------|------|
| **1** | 1.1 Reclubbing (Option A: LLM reclub), 1.2 Validation (required fields, drop bad), 1.3 Enforce parent creation | Fixes "all parents"; ensures families exist |
| **2** | 2 Validation step (schema + noise filter), 5 Created vs updated counts, 6 Parent trends get real content | Quality and accurate metrics |
| **3** | 3 Web fallback URLs, 4 Rule hierarchy (document + optional id later), 7 Pruning by strength+recency | Reliability and better pruning |
| **4** | 8 Admin comment-only (prompt + optional schema), 9 Rule dedup (larger window or bodyNormalized) | Polish and scale |
| **5** | 10 Provenance (optional) | Audit and debug |

---

## Success criteria

- After a run, a significant share of trends are **children** (parentId set), not all parents.
- Run result includes accurate `trendsCreated` vs `trendsUpdated` and `rulesCreated` vs `rulesUpdated`.
- Parent trend rows have real descriptions and details when the LLM provides them.
- Validation drops clearly invalid or duplicate items; optional quality filter can be enabled.
- Web fetch succeeds at least when fallback URLs are configured and allowlist is set.
- Pruning keeps strong and recent content; stale/weak content is removed first.
