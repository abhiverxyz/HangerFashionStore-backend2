# Agent agentic audit (B0–B9)

**Criteria (from ARCHITECTURE_AGENTS_AND_SERVICES.md):**  
Agents **generate** (LLM/vision/tools) and **validate** (coherence, intent, quality) before returning or writing. They use **tools** (services, utilities).

**Legend:**
- **Fully agentic** — Generate + explicit validate (or equivalent quality gate) + tool use; fallbacks where appropriate.
- **Partially agentic** — Generate + tools + fallbacks, but **no explicit validation step** (no coherence/quality check before return or write).
- **N/A** — Router: classifies and routes only; no artifact generation.

---

## B0 — No agents

Utilities only (image analysis, LLM, storage, embeddings). No agent to audit.

---

## B1 — Fashion Content Agent

| Criterion    | Status |
|-------------|--------|
| Generate    | ✅ LLM for trends/rules, URL suggestion, reclub; optional vision for admin sources. |
| Validate    | ✅ `validateTrends()`, `validateRules()` (schema + min length); `llmReclubTrends` for structure. |
| Tool use    | ✅ Fashion Content Service (read/write), fetch URLs, listAllowedFashionDomains. |
| Fallbacks   | ✅ Reclub errors recorded; fallback URLs from env. |

**Verdict: Fully agentic.**

---

## B2 — Router, Styling Agent

### Router
**Verdict: N/A.** Classifies intent and routes; does not generate or validate an artifact.

### Styling Agent

| Criterion    | Status |
|-------------|--------|
| Generate    | ✅ LLM (intent extraction, reply + cards); `analyzeImage` for validate_outfit; Look Composition, product search. |
| Validate    | ✅ `validateReplyAgainstIntent()` — LLM check that reply matches intent; returns `suggestedFix` if not ok; reply replaced before return. |
| Tool use    | ✅ Look Composition Service, product search, User Profile, Fashion Content, image generation. |
| Fallbacks   | ✅ validate_outfit failure → generic message; validation catch returns null (keep reply). |

**Verdict: Fully agentic.**

---

## B3 — User Profile Agent, Search Agent

### User Profile Agent

| Criterion    | Status |
|-------------|--------|
| Generate    | ✅ LLM from profile context → need & motivation. |
| Validate    | ✅ `validateNeedAndMotivation()` — LLM check that need/motivation are coherent, on-topic for fashion, not overly generic; returns suggested fix when !ok. |
| Tool use    | ✅ User Profile Service (getUserProfile, writeNeedMotivation). |
| Fallbacks   | ✅ Existing or FALLBACK_NEED/MOTIVATION on LLM failure or when validation suggests no fix; length caps. |

**Verdict: Fully agentic.** (Updated: validation step added with optional suggestedNeed/suggestedMotivation.)

### Search Agent

| Criterion    | Status |
|-------------|--------|
| Generate    | ✅ Product search (text/image) + optional LLM summary. |
| Validate    | ✅ When results exist, `validateSearchRelevance()` — LLM checks whether results match query; if not, uses suggestedReply to set expectations. Rule-based `validateRelevance()` for no results. |
| Tool use    | ✅ searchProducts (embeddings/product domain). |
| Fallbacks   | ✅ Summary LLM catch → null; then static reply; relevance validator failure → keep current reply. |

**Verdict: Fully agentic.**

---

## B4 — Look Analysis, Style Report, Wardrobe Extraction

### Look Analysis Agent

| Criterion    | Status |
|-------------|--------|
| Generate    | ✅ Vision (`analyzeImage`) + second LLM (analysisComment, suggestions, classificationTags). |
| Validate    | ✅ Second LLM step acts as validation/contextualization (profile, trends, rules, allowed tags). |
| Tool use    | ✅ Image analysis, storage (upload), Looks API, User Profile, Fashion Content, classification tags. |
| Fallbacks   | ✅ Second step returns {} on parse/error; profile/trends/rules fetch failures logged, continue. |

**Verdict: Fully agentic.**

### Style Report Agent

| Criterion    | Status |
|-------------|--------|
| Generate    | ✅ Multi-step: load looks, build byLooks/byItems, LLM (style profile + report), optional LLM (comprehensive). |
| Validate    | ✅ Structured parsing; `normalizeComprehensive()`; schema-aware handling. |
| Tool use    | ✅ Looks, User Profile (writeStyleProfile, saveLatestStyleReport). |
| Fallbacks   | ✅ Minimal report on main LLM failure; comprehensive optional step skipped on failure. |

**Verdict: Fully agentic.**

### Wardrobe Extraction Agent

| Criterion    | Status |
|-------------|--------|
| Generate    | ✅ Vision (extract items) + product search per slot (suggestions). |
| Validate    | ✅ Per-slot `validateSlotMatchQuality()` (LLM): which suggestions match the extracted item; filter to goodIndices before return. |
| Tool use    | ✅ analyzeImage, searchProducts, getLook. |
| Fallbacks   | ✅ Image analysis / no items → clear error; search per slot via Promise.allSettled; validator failure for a slot → keep that slot's suggestions unchanged. |

**Verdict: Fully agentic.**

---

## B5 — Look Planning Agent

| Criterion    | Status |
|-------------|--------|
| Generate    | ✅ LLM plan (diverse looks) + Look Composition per slot. |
| Validate    | ✅ Per-run `validatePlannedSetCoherence(occasion, looks)` (LLM): diversity/coherence check; result surfaced in planSummary. |
| Tool use    | ✅ LLM, getUserProfile, composeLook. |
| Fallbacks   | ✅ LLM parse failure → single fallback slot; per-slot composeLook failure → slot with error, empty products; validator failure → keep looks and planSummary unchanged. |

**Verdict: Fully agentic.**

---

## B6 — MicroStore Curation Agent

| Criterion    | Status |
|-------------|--------|
| Generate    | ✅ LLM (title, description, styleNotes, vibe, trends, categories), richer store image prompt (admin params + optional reference image via vision), product search, sections. |
| Validate    | ✅ `validateMicrostoreCoherence()` — LLM check that products align with title/description/vibe; optional one-time reselect with suggestedSearchHint. After image generation, `selectStoreImage()` chooses generated vs product image. |
| Tool use    | ✅ LLM, generateImage, analyzeImage (vision for reference), searchProducts, getUserProfile, creationContext, Prisma. |
| Fallbacks   | ✅ Default styleNotes when empty; validation/reselect skip on failure; reference image analysis failure → text-only prompt; image selection fallback to first candidate. |

**Verdict: Fully agentic.** (Updated: validation + optional reselect, store image aligned with admin params and reference images, image selection generated vs product; store image editable in admin.)

---

## B7 — Match Agent

| Criterion    | Status |
|-------------|--------|
| Generate    | ✅ LLM (itemMatches, summary) from profile + wishlist. |
| Validate    | ✅ Output shape validated; per-run `validateMatchAnalysisCoherence()` (LLM): coherent and fair check; result in summary when !ok. |
| Tool use    | ✅ getUserProfile, listWishlist, complete. |
| Fallbacks   | ✅ On LLM failure returns items with null matchSummary/matchScore; validator failure → keep summary unchanged. |

**Verdict: Fully agentic.**

---

## B8 — No new agents

Brand admin and analytics only. No agent to audit.

---

## B9 — Feed Agent

| Criterion    | Status |
|-------------|--------|
| Generate    | ✅ LLM (text ideas; video URL ideas), creates draft posts. |
| Validate    | ✅ Filtering (title, type, video host); before creating drafts `validateFeedIdeasDiversity()` (LLM): diverse and non-duplicative vs current feed; filter to goodIndices. |
| Tool use    | ✅ complete, contentFeed (list, create). |
| Fallbacks   | ✅ Parse failure → empty suggestions; type default “drop”; validator failure → keep all ideas, create drafts as-is. |

**Verdict: Fully agentic.**

---

## Summary

| Agent                  | Phase | Verdict           |
|------------------------|-------|-------------------|
| Fashion Content Agent  | B1    | **Fully agentic** |
| Styling Agent          | B2    | **Fully agentic** |
| User Profile Agent     | B3    | **Fully agentic** |
| Search Agent           | B3    | **Fully agentic** |
| Look Analysis Agent    | B4    | **Fully agentic** |
| Style Report Agent     | B4    | **Fully agentic** |
| Wardrobe Extraction   | B4    | **Fully agentic** |
| Look Planning Agent   | B5    | **Fully agentic** |
| MicroStore Curation   | B6    | **Fully agentic** |
| Match Agent           | B7    | **Fully agentic** |
| Feed Agent            | B9    | **Fully agentic** |

**Fully agentic (11):** Fashion Content, Styling, User Profile, Search, Look Analysis, Style Report, Wardrobe Extraction, Look Planning, MicroStore Curation, Match, Feed.  
**Partially agentic (0):** —  
**N/A (1):** Router.

---

## Recommended next steps (optional)

To move “partially” agents toward “fully agentic” without large redesigns:

1. **User Profile Agent** — ✅ Done. Added `validateNeedAndMotivation()` (LLM); uses suggested fix or existing/fallback when !ok. (Was: Add a short LLM or rule check: “Is this need/motivation coherent and on-topic?”; reject or re-prompt if not.
2. **Search Agent** — Done. Added `validateSearchRelevance()` (LLM); when results don’t match well, uses suggestedReply to set expectations.
3. **Wardrobe Extraction** — ✅ Done. Per-slot `validateSlotMatchQuality()` (LLM) filters suggestions to goodIndices; validator failure keeps current suggestions.
4. **Look Planning Agent** — ✅ Done. Per-run `validatePlannedSetCoherence(occasion, looks)` (LLM); result in planSummary; validator failure keeps looks unchanged.
5. **MicroStore Curation Agent** — LLM or rules to check “Do products align with title/description?”; Done. Added validateMicrostoreCoherence (optional reselect), richer store image (admin params + reference images via vision), selectStoreImage (generated vs product).
6. **Match Agent** — ✅ Done. Per-run `validateMatchAnalysisCoherence()` (LLM); result in summary when !ok; validator failure keeps output unchanged.
7. **Feed Agent** — ✅ Done. Before creating drafts `validateFeedIdeasDiversity()` (LLM) filters to goodIndices; validator failure keeps all ideas.

These are incremental enhancements; current implementations already have generate + tools + fallbacks.
