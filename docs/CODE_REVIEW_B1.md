# Code review: backend2 & frontend2 (through B1)

Review covers **speed**, **scalability**, **architecture**, **duplicates**, and **simplifications** for the codebase through B1 (Fashion Content Agent, User Profile, model config, etc.).

---

## 1. Architecture (backend2)

| Layer | Role | Status |
|-------|------|--------|
| **Routes** | HTTP only; delegate to domain/agents; use asyncHandler, auth middleware | ✅ Clear |
| **Agents** | Single agent so far (Fashion Content); uses domain + utils | ✅ Clear |
| **Domain** | Data access and business logic (fashionContent, userProfile, product, looks, wardrobe, userImage, user/auth) | ✅ Clear |
| **Utils** | LLM, vision, image analysis, image generation, storage, queue, parseJsonResponse, openaiClient | ✅ No business logic |
| **Config** | modelConfig (resolution + cache) + modelConfigDb (persistence) | ✅ Clean split |
| **Core** | db (Prisma singleton), asyncHandler, helpers, constants | ✅ Minimal |

**Active docs:** `IMPLEMENTATION_PLAN_PHASES.md`, `ARCHITECTURE_AGENTS_AND_SERVICES.md`, `FASHION_CONTENT_AGENT_IMPROVEMENTS_PLAN.md`, `SHARED_DATABASE_MIGRATION_GUIDE.md`, `MODEL_CONFIG_SETUP_AND_IMPACT.md`, `PHASE4_AGENTS_AND_LLM_DISCUSSION.md` (future Phase 4). **Archived:** `docs/archive/PHASE3_PLAN.md`, `docs/archive/CODE_REVIEW_MODEL_CONFIG_AND_UTILITIES.md`.

**Recommendations:**
- Keep agents in `src/agents/` and domain in `src/domain/<area>/`. No change.
- When adding more agents, keep each agent in one file and use shared utils/domain only.

---

## 2. Speed

| Area | Finding | Recommendation |
|------|---------|----------------|
| **DB** | Prisma with pg Pool (max 20, connectionTimeout 5s). getPrisma() singleton. | ✅ Good. For many concurrent requests, consider tuning Pool size via env. |
| **Model config** | 60s in-memory cache per scope; getAllModelConfig uses Promise.all when cache cold. | ✅ Good. |
| **OpenAI** | Single getOpenAIClient() singleton; one key check per process. | ✅ Good. |
| **Fashion Content Agent** | Sequential: admin → URLs → LLM suggest → fetch URLs → LLM generate → validate → reclub → write (parents then children). Top-up and pruning after. | Acceptable for on-demand/cron. If run often, consider moving reclub/validation to a queue. |
| **Pruning (trends/rules)** | Loads all rows into memory, computes composite score (strength + recency), sorts, deletes. | Fine for &lt;10k rows. For very large tables, add batching or DB-side scoring (see §4). |
| **findStylingRuleByBody** | Fetches up to 2000 rules, normalizes in JS. | ✅ Bounded. |
| **List endpoints** | listTrends, listStylingRules use limit (max 100) and offset. | ✅ Pagination in place. |

---

## 3. Scalability

| Topic | Status | Notes |
|-------|--------|------|
| **Horizontal scaling** | Stateless API; DB and Redis are shared. | Multiple backend2 instances OK. |
| **Model config cache** | In-memory per process; TTL 60s. | Admin PUT invalidates only the instance that served the request. Others refresh within 60s. For cross-instance invalidation, consider Redis or broadcast later. |
| **Redis** | Used for enrichment and sync queues; single client per process. | Worker can run on one or more nodes; job claimed by first consumer. |
| **Fashion agent** | Single long run (LLM + writes). | Not parallelized; suitable for cron or rare on-demand runs. |
| **Pruning** | O(n) memory for n trends/rules. | Document; if n grows very large (e.g. 50k+), consider batch delete by score range or raw SQL. |
| **DB indexes** | Product: brandId+status+updatedAt, category, enrichmentStatus, etc. Trend/StylingRule: standard. | ✅ Adequate for current usage. |

---

## 4. Duplicates and dead code

| Item | Action |
|------|--------|
| **Bearer token extraction** | Repeated in requireAuth, requireAdmin, auth.js (session). | **Done:** Centralized in `core/getBearerToken.js`; all auth paths use it. |
| **Docs** | PHASE3_PLAN, CODE_REVIEW_MODEL_CONFIG are historical. | **Done:** Moved to `docs/archive/`. |
| **Utils** | imageAnalysis uses vision/index; llm uses openaiClient; vision/openai uses openaiClient + parseJsonResponse. | No duplicate logic. |
| **modelConfig vs modelConfigDb** | One resolves (env + DB + cache), one does DB read/write. | Correct separation. |

---

## 5. Simplifications applied

- **getBearerToken(req)** — Single place for `Authorization: Bearer <token>` parsing; used by requireAuth, requireAdmin, auth session.
- **Pruning** — Comment in domain/fashionContent: when trend/rule count is very high, consider batching or DB-side scoring.
- **Docs** — Archive folder for obsolete phase/review docs; keep IMPLEMENTATION_PLAN_PHASES, ARCHITECTURE_AGENTS_AND_SERVICES, FASHION_CONTENT_AGENT_IMPROVEMENTS_PLAN, SHARED_DATABASE_MIGRATION_GUIDE, MODEL_CONFIG_SETUP_AND_IMPACT as active references.

---

## 6. Frontend2 (architecture and speed)

| Area | Finding |
|------|---------|
| **API layer** | Single `lib/api/client.ts`: apiFetch, apiFetchWithAuth. All API modules use it. ✅ |
| **Auth** | AuthProvider (context) + useRequireAuth (guard) + storage (token). No duplication. ✅ |
| **Admin** | Admin pages (dashboard, fashion-content, products, brands, microstores, settings, content) share layout and auth. content/page is a stub (“Coming soon”). ✅ |
| **Data fetching** | No global data library; pages fetch on load or on action. Acceptable for current size. For many admin lists, consider React Query or SWR later. |
| **Types** | Types in lib/api/* and lib/types/auth. Trend/StylingRule in fashionContent.ts. ✅ |

**Recommendations:**
- Keep admin/content as stub until feed/content features exist.
- If admin lists grow (e.g. 100+ products, many brands), add client-side pagination or virtual list and consider caching (React Query/SWR).

---

## 7. Security and config

- **JWT:** requireAuth and requireAdmin use same verifyToken/getUser; requireAdminOrSecret used only for import endpoints (CLI script). ✅
- **CORS:** Configurable via CORS_ORIGIN; dev allows request origin. ✅
- **Body size:** express.json 50mb for import-public-payload. ✅
- **Secrets:** JWT_SECRET, OPENAI_API_KEY, DATABASE_URL, etc. from env; no secrets in repo. ✅

---

## 8. Summary

- **Architecture:** Clear separation of routes, agents, domain, utils, config. No changes required.
- **Speed:** DB pool, model config cache, OpenAI singleton, and list limits are in good shape. Agent and pruning are acceptable for current scale.
- **Scalability:** Stateless API; pruning and model config cache have documented limits for very large data / multi-instance.
- **Duplicates:** Bearer token extraction centralized; obsolete docs archived.
- **Simplifications:** getBearerToken in use; pruning comment added; docs reorganized.

No unnecessary files remain in active docs; archive preserves historical phase/review docs for reference.
