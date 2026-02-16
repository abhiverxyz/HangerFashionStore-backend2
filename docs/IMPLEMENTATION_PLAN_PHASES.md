# Implementation plan: Architecture, phases, backend first then frontend

This document gives: (1) a single reference for **all services and agents and the architecture**; (2) a **phase-wise implementation plan**; (3) **backend phases first**, then **frontend phases** that consume the backend APIs. It assumes Phase 1–3 (auth, products, looks, wardrobe, user-images, image generation) are done in backend2.

Reference: `ARCHITECTURE_AGENTS_AND_SERVICES.md` for detailed functionality mapping and design decisions.

---

# Part A: Architecture — utilities, services, and agents

Everything we build is one of: **utility**, **service**, **agent**, or **API** (route). Utilities and services are used by agents and by other services; agents use utilities and services as tools.

## A.1 High-level picture

- **Router** receives each user turn and picks **one agent**. Agents **generate** and **validate**; they use **utilities** and **services** (and existing APIs) as tools.
- **Utilities** are generic, reusable capabilities (image analysis, image generation, LLM, storage, embeddings). No business logic; used by many agents/services.
- **Services** own data and domain logic; they do not converse. Agents and APIs call services.
- **Conversation Service** persists chat and is the single entry for `handleTurn` → Router → agent → persist reply → return.

```
User → Conversation Service → Router → [Agent] → utilities + services + APIs
                ↓                              ↓
         Conversation DB                 Generate + validate
```

## A.2 Utilities and generic services

Shared capabilities used by agents and services. Implement once; reuse everywhere.

| Utility | Purpose | Used by (examples) | Phase 1–3 / build |
|---------|---------|---------------------|-------------------|
| **Image analysis (Vision)** | Analyze image: describe, categorize, extract entities (e.g. garments, vibe, occasion). Input: image URL or buffer; optional prompt. Output: structured analysis (labels, vibe, occasion, comment, or custom schema). | Look Analysis Agent, Style Report Agent, Wardrobe Extraction Agent | Build in **B0** |
| **Image generation** | Generate image from prompt; upload to storage; return URL. (Phase 3 already has this as API + domain.) Expose as a **utility** so agents call one interface: `generateImage(prompt, options)`. | Styling Agent, Look Composition Service, MicroStore Curation Agent | **Phase 3** (document as utility); optional wrapper in B0 |
| **LLM** | Completion/chat with optional vision. Single interface for all agents (prompt, messages, options). | All agents | Phase 1–2 (existing `utils/llm.js`); extend if needed in **B0** |
| **Storage** | Upload buffer → URL (R2 or local). | Look analysis (persist look image), style report, wardrobe upload, image generation output | **Phase 3** (document as utility) |
| **Embeddings** (optional) | Text or image → vector. For semantic product search, “closest items”, personalization. | Search Agent, Wardrobe Extraction “closest items”, Personalization | Build in **B0** or **B3** when search is built |

**Summary:** Image analysis (vision), LLM, and optionally Embeddings are **utilities** we build or formalize in **B0**. Image generation and Storage are already in Phase 3; we treat them as utilities and reference them from the plan.

## A.3 All agents

| Agent | Scope (Functionality) | Main tools | Output |
|-------|------------------------|------------|--------|
| **Router** | Route each turn | — | Which agent to run |
| **Look Analysis Agent** | 1.1 Fashion diary | Vision/LLM, Looks API | Comment + vibe/occasion/time; persist look |
| **Style Report Agent** | 1.2 Style report | Image processing, LLM, User Profile Service | report.json; write style profile to User Profile Service |
| **Wardrobe Extraction Agent** | 1.3 Digital wardrobe | Vision, product search “closest items”, Wardrobe API | Suggestions; accept → wardrobe |
| **Styling Agent** | 1.4 Get ready + 1.8 General styling | Look Composition, product search, generate image, User Profile, Fashion Content, LLM | Reply + cards (looks, items, tips) |
| **Look Planning Agent** | 1.5 Looks planning | LLM, product/look retrieval, Look Composition | Structured plan (looks + diversity) |
| **User Profile Agent** | 1.7 (need & motivation) | LLM, User Profile Service (read/write) | Write fashion need & motivation to User Profile Service |
| **MicroStore Curation Agent** | 2.2, 2.4 MicroStores / Store for you | Product search, Fashion Content, image generation, LLM | Candidate microstore → MicroStore Service |
| **Fashion Content Agent** | 4.1 (keep content current) | LLM, sources, Fashion Content Service (read/write) | Update trends & styling rules in Fashion Content Service |
| **Search Agent** | 2.1 Find items | Product/brand/microstore search | Results + optional NL summary |
| **Match Agent** (optional) | 1.6 Wishlist match | User Profile, product data | “Match to you” analysis for wishlist |

## A.4 All services

| Service | Scope | Responsibilities |
|---------|--------|-------------------|
| **User Profile Service** | 1.7 | Store & aggregate: style profile, user history, fashion need, fashion motivation, quiz. Expose `getUserProfile(userId)`. **Subsets**: style profile store, user history store, need/motivation store. |
| **Look Composition Service** | 1.4, 1.5 | Pure build: vibe, occasion, constraints → one look (product list + optional image). No chat. |
| **Fashion Content Service** | 4.1 | Store & serve trends, styling rules (for Styling Agent, MicroStore Curation, etc.). **Updated by** Fashion Content Agent. |
| **MicroStore Service** | 2.2, 2.4 | Persist microstores; approval; list with personalized order; follow; “Store for you” (invoke MicroStore Curation Agent, cache, refresh). |
| **Personalization Service** | 2.5, 3 | Profile + context → ordering/scores for products, microstores, brands; landing page. |
| **Brand Zone Service** | 2.3 | CRUD, approval, default zone, list with personalized order, follow, brand search. |
| **Preferences Service** | 1.6 | Wishlist, follow brands/microstores. Optional match analysis. |
| **Conversation Service** | All chat | Persist conversation & messages; handleTurn → Router → agent → persist reply → return. |

## A.5 Existing (Phase 1–3) used by agents

- **Auth** (JWT, requireAuth)
- **Products** (list, get by id)
- **Looks** (CRUD, imageUrl, vibe, occasion)
- **Wardrobe** (CRUD, upload)
- **UserImage** (upload, list)
- **Image generation** (`POST /api/generate/image`)
- **Storage** (R2 or local)

## A.6 Principle: generate + validate

Every agent that produces content: (1) **Generate** the artifact; (2) **Validate** (coherence, intent, quality); (3) **Return** or **write to service** after validation or fallback.

---

# Part B: Phase-wise plan — backend first

Backend phases are ordered: **B0 utilities** first, then **B1+** (foundation services, then agents and APIs). Every deliverable is classified as **utility**, **service**, **agent**, or **API**.

---

## Backend Phase B0: Utilities and generic services

**Goal:** All shared capabilities (image analysis, image generation wrapper, LLM, storage reference, optional embeddings) are in place so agents and services can use them.

| # | Deliverable | Type | Details |
|---|-------------|------|---------|
| B0.1 | **Image analysis (Vision) utility** | utility | Single interface: `analyzeImage(imageUrlOrBuffer, options?)` → structured result (e.g. description, vibe, occasion, labels, or custom prompt). Use LLM vision or dedicated vision API. Used by Look Analysis, Style Report, Wardrobe Extraction. |
| B0.2 | **Image generation utility** | utility | Wrap Phase 3 domain as utility: `generateImage(prompt, options)` → { imageUrl }. Agents call this instead of calling the HTTP API directly. (Phase 3 already implements; B0 only formalizes the utility interface.) |
| B0.3 | **LLM utility** | utility | Ensure one place for completions/chat (and vision): `complete(messages, options)`. Extend existing `utils/llm.js` if needed (e.g. vision, streaming). All agents use this. |
| B0.4 | **Storage utility** | utility | Already Phase 3: `uploadFile(buffer, key, contentType)` → url. Document as shared utility; no code change unless we add a thin wrapper. |
| B0.5 | **Embeddings utility** (optional) | utility | `embedText(text)` and optionally `embedImage(imageUrl)` → vector. For semantic product search and “closest items.” Can be deferred to B3 if search is simpler first. |

**Outcome:** Agents and services have a single place to call image analysis, image generation, LLM, storage, and (if built) embeddings.

**Dependencies:** None (or Phase 3 for image gen + storage). B0 can start in parallel with or just before B1.

**Testing B0:** From `backend2` run:
- `npm run test:b0` — tests image analysis (vision), LLM complete, embedText, storage upload. Requires `OPENAI_API_KEY` and storage (R2 or local) in `.env`.
- `npm run test:b0:all` — same plus image generation (uses Replicate credits). Requires `REPLICATE_API_TOKEN`.

---

## Backend Phase B1: Foundation — profile and fashion content

**Goal:** User Profile and Fashion Content available so later agents can depend on them.

| # | Deliverable | Type | Details |
|---|-------------|------|---------|
| B1.1 | **User Profile Service** | service | Schema (style profile, user history, fashion need, fashion motivation, quiz). APIs: get profile, write style profile, append history, write need/motivation, submit quiz. Subsets implemented as logical stores or tables. |
| B1.2 | **Fashion Content Service** | service | Schema (trends — reuse existing Trend; styling rules — new StylingRule). APIs: list/search trends, list styling rules, get trend/get rule by id. Auth required for GET. No entertainment content (see Content Feed / Fashion edit). |
| B1.3 | **Fashion Content Agent** | agent | Job (scheduled or on-demand): search for latest trends and styling rules (LLM/sources); validate; update Fashion Content Service. Can run as worker or cron. |
| B1.4 | **User Profile API** | API | Routes for get profile, submit quiz, (write style profile / history may be internal or via other APIs). |

**Outcome:** `getUserProfile(userId)` works; trends and styling rules can be stored and served; Fashion Content Agent keeps them updated.

**Dependencies:** B0 (LLM utility); existing DB.

---

## Backend Phase B2: Conversation and styling

**Goal:** User can send a message and get a styling reply (Get ready + general styling).

| # | Deliverable | Type | Details |
|---|-------------|------|---------|
| B2.1 | **Conversation Service** | service | Schema: Conversation, ConversationMessage (already in Prisma). Create/list conversations; append message; load last N for context. Single entry: `handleTurn(userId, conversationId, message, imageUrl?)`. |
| B2.2 | **Router** | agent | Given message + conversation history + optional image → decide which agent (for B2, only Styling Agent). Return agent id or invoke directly. |
| B2.3 | **Look Composition Service** | service | Input: vibe, occasion, productIds or constraints, optional user context. Output: one look (product list + optional generated image via **image generation utility**). No chat. |
| B2.4 | **Styling Agent** | agent | Interpret intent from message (+ image); use Look Composition for looks, product search for items; call User Profile, Fashion Content, **LLM utility**, **image generation utility**; generate reply + cards; validate. Implements 1.4 + 1.8. |
| B2.5 | **Conversation API** | API | e.g. `POST /api/conversations/:id/messages` (message, imageUrl?) → handleTurn → return assistant reply + payload (cards, etc.). |

**Outcome:** Chat API works; user gets styling/get-ready replies and cards.

**Dependencies:** B0 (LLM, image generation utility); B1 (User Profile, Fashion Content); Phase 3 (products, looks).

---

## Backend Phase B3: User profile enrichment and search

**Goal:** Profile has generated need/motivation; user can search products (and optionally brands/microstores) via NL.

| # | Deliverable | Type | Details |
|---|-------------|------|---------|
| B3.1 | **User Profile Agent** | agent | Input: history + style profile (+ quiz) from User Profile Service. Generate fashion need & motivation (**LLM utility**); validate; write back to User Profile Service. Trigger: on new history/style or scheduled. |
| B3.2 | **Product search (NL/semantic)** | service | Extend product domain or add search service: natural language / semantic search over products (uses **embeddings utility** if built in B0). Optional: image-based search (“close to this image”). |
| B3.3 | **Search Agent** | agent | Query (text or image) → product (and later brand/microstore) search → results + optional NL summary (**LLM utility**); validate relevance. Refinement = another turn. |
| B3.4 | **Search API** | API | e.g. `POST /api/search` or via conversation (Router can route to Search Agent). Expose search for search bar and chat. |
| B3.5 | **Router intent and routing** | agent | Extend Router: classify turn intent (e.g. styling vs search) from message + history + optional image; route to Styling Agent or Search Agent; return agent result in conversation format. Enables search via chat. Implement via LLM intent classification or rules; default to Styling when unclear. |

**Outcome:** Profile has need/motivation; search works from API and from chat; Router chooses Styling vs Search by intent.

**Dependencies:** B0 (LLM; embeddings if used); B1 (User Profile); product catalog.

---

## Backend Phase B4: Fashion diary, style report, wardrobe extraction

**Goal:** 1.1, 1.2, 1.3 implemented.

| # | Deliverable | Type | Details |
|---|-------------|------|---------|
| B4.1 | **Look Analysis Agent** | agent | Input: look image(s) or look id. **Image analysis utility** + **LLM utility** → comment (validation/encouragement/suggestion) + vibe/occasion/time; validate; persist look (Looks API, **storage utility**). Support bulk or single. |
| B4.2 | **Look analysis API** | API | e.g. `POST /api/looks/analyze` (upload image or lookId) → comment + categories; persist. |
| B4.3 | **Style Report Agent** | agent | Input: user image refs. **Image analysis utility** + **LLM utility**; generate report.json + style profile fields; validate; write style profile to User Profile Service. |
| B4.4 | **Style report API** | API | e.g. `POST /api/style-report` (image refs or uploads) → report.json + style profile updated. |
| B4.5 | **Wardrobe Extraction Agent** | agent | Input: look (image or id). **Image analysis utility** (extract items) → product search “closest items” (**embeddings utility** or search service) → suggest product IDs per slot; validate. Accept endpoint writes selected items to Wardrobe API. |
| B4.6 | **Wardrobe extraction API** | API | e.g. `POST /api/wardrobe/extract-from-look`, `POST /api/wardrobe/accept-suggestions` (or similar). |
| B4.7 | **Extend Router** | agent | Add intent paths for B4 agents: e.g. image + diary/analyze intent → Look Analysis Agent; image + style report intent → Style Report Agent; look + wardrobe intent → Wardrobe Extraction Agent. Conversation can trigger these agents when intent matches; otherwise keep routing to Styling or Search. |

**Outcome:** Fashion diary (analyze + comment), style report, digital wardrobe extraction and accept; chat can route to these agents by intent.

**Dependencies:** B0 (Image analysis, LLM, storage; embeddings if “closest items” is semantic); B1 (User Profile); Phase 3 (Looks, Wardrobe, products).

---

## Backend Phase B5: Look planning and personalization

**Goal:** 1.5 looks planning; 2.5 and 3 personalization.

| # | Deliverable | Type | Details |
|---|-------------|------|---------|
| B5.1 | **Look Planning Agent** | agent | Input: occasion (e.g. vacation), constraints. **LLM utility** + product/look retrieval + Look Composition Service → planned set of looks (diversity); validate. |
| B5.2 | **Look planning API** | API | e.g. `POST /api/look-planning` or via conversation. |
| B5.3 | **Personalization Service** | service | Input: profile + context (listing type, search query, etc.). Output: ordering/scores for products, microstores, brands; landing page choice. |
| B5.4 | **Personalization hooks** | API | Listing APIs (products, later microstores/brands) call Personalization Service to order results. Landing page API uses it for “which page to show”. |
| B5.5 | **Extend Router** | agent | Add intent path for Look Planning Agent: e.g. occasion/planning intent (“plan looks for vacation”, “outfits for a trip”) → Look Planning Agent. Conversation can trigger look planning when intent matches. |

**Outcome:** Look planning API; personalized listing and landing; chat can route to Look Planning by intent.

**Dependencies:** B1 (User Profile); B2 (Look Composition); product list.

---

## Backend Phase B6: MicroStores and Store for you

**Goal:** 2.2, 2.4.

| # | Deliverable | Type | Details |
|---|-------------|------|---------|
| B6.1 | **MicroStore Service** | service | Schema: MicroStore (topics, itemIds, bannerUrl, notes, status, etc.). CRUD; approval workflow; list with personalized order; follow. “Store for you”: get userId → invoke MicroStore Curation Agent with profile → cache result; refresh on visit or 24h. |
| B6.2 | **MicroStore Curation Agent** | agent | Trigger: schedule (system microstores) or “Store for you” (userId). **LLM utility** + Fashion Content + product search → topics; select 20–40 items; **image generation utility** (banner); **LLM utility** (style notes); validate; return candidate → MicroStore Service persists. |
| B6.3 | **MicroStore APIs** | API | List (personalized), get by id, follow/unfollow. Admin: create, approve. “Store for you”: GET for current user (cache/refresh). |
| B6.4 | **Product/brand search for Search Agent** | service | Extend search so Search Agent can search microstores (and later brands) for 2.1. |

**Outcome:** Microstores (system + admin); Store for you per user; search can include microstores.

**Dependencies:** B0 (LLM, image generation); B1 (User Profile, Fashion Content); B5 (Personalization); product search.

---

## Backend Phase B7: Brand zones and preferences

**Goal:** 2.3 brand zones; 1.6 preferences (wishlist, follow).

| # | Deliverable | Type | Details |
|---|-------------|------|---------|
| B7.1 | **Brand Zone Service** | service | Schema: BrandZone (or use existing Brand + zone fields). CRUD; approval; default zone; list with personalized order; follow; brand search (NL or keyword). |
| B7.2 | **Brand zone APIs** | API | List, get, follow. Admin: create, approve. Search: by natural language (can call Search Agent or dedicated). |
| B7.3 | **Preferences Service** | service | Schema: Wishlist, FollowBrand, FollowMicrostore (or equivalent). APIs: wishlist CRUD, follow/unfollow brands and microstores. |
| B7.4 | **Match Agent** (optional) | agent | Given profile + wishlist items → **LLM utility** “match to you” analysis; validate. API or part of wishlist response. |
| B7.5 | **Extend Router** (optional) | agent | If Match Agent exists: add intent path for wishlist/match intent (“match my wishlist to me”, “which suit my style”) → Match Agent. Conversation can trigger match analysis when intent matches. |

**Outcome:** Brand zones and preferences (wishlist, follow) with APIs; optionally chat can route to Match Agent by intent.

**Dependencies:** B1, B5 (Personalization for ordering).

---

## Backend Phase B8: Brand admin and analytics

**Goal:** Brand can create zones/microstores, publish, view analytics.

| # | Deliverable | Type | Details |
|---|-------------|------|---------|
| B8.1 | **Brand admin APIs** | API | Create/edit brand zone, create/edit microstore (with items in brand’s scope); submit for approval. Admin approval endpoints. |
| B8.2 | **Analytics** | service | Consumer analytics for brand: views, engagement, comparison to own brand. Can be aggregated reads from existing events/listings. |

**Outcome:** Brand admin and basic analytics.

**Dependencies:** B6 (MicroStore), B7 (Brand Zone).

---

## Backend Phase B9: Content feed (Fashion edit)

**Goal:** High-quality entertainment content (reels, videos, images) for users. Separate from Fashion Content Service (which is for trends/styling rules used by agents). Posted by brands or admin.

| # | Deliverable | Type | Details |
|---|-------------|------|---------|
| B9.1 | **Content Feed Service** | service | Backed by existing FeedPost (or extend). Store & serve feed items: type (e.g. image/video), title, media URL, caption, brandId, approval status. List feed (paginated, filters); get by id. |
| B9.2 | **Content Feed APIs** | API | List feed (for app/reels UI); get item by id. Admin/brand: create, edit, submit for approval. Admin: approve/reject. Auth: require auth for read; brand/admin for write. |

**Outcome:** Fashion edit / reels backend: feed of high-quality content for users; brands and admin can post; no Fashion Content Agent involvement.

**Dependencies:** Phase 3 (storage for media); B8 (brand admin for brand posting). Existing FeedPost schema may be reused.

---

# Part C: Phase-wise plan — frontend

Frontend phases assume backend phases are available (or stubbed) so UI can call APIs. Mobile vs desktop can be handled in the same phases with responsive or separate layouts as needed.

---

## Frontend Phase F1: Auth, profile, and shell

**Goal:** User can log in, see profile shell, and app has a stable layout/navigation.

| # | Deliverable | Details |
|---|-------------|---------|
| F1.1 | **Auth UI** | Login (and optional signup if backend exists). Store token; send Bearer on API calls. |
| F1.2 | **Profile/settings shell** | Profile page or settings: show basic profile (from User Profile API when B1 is ready); placeholder for style report, quiz. |
| F1.3 | **App shell** | Navigation, layout (mobile + desktop), routing. Landing entry (can be personalized later with B5). |

**Depends on backend:** Auth (Phase 1–2); optionally B1 (get profile).

---

## Frontend Phase F2: Fashion diary, style report, wardrobe

**Goal:** 1.1, 1.2, 1.3 UI.

| # | Deliverable | Details |
|---|-------------|---------|
| F2.1 | **Fashion diary** | Upload look (single + bulk); call Look analysis API; display looks with comment and categories (vibe, occasion, time); file/browse as diary. |
| F2.2 | **Style report** | Upload user images; call Style report API; render report (report.json → styled view). |
| F2.3 | **Wardrobe** | List wardrobe; “extract from look” flow: select look → call extraction API → show suggestions → accept/reject → update wardrobe. |

**Depends on backend:** Phase 3 (looks, wardrobe); B4 (Look Analysis, Style Report, Wardrobe Extraction APIs).

---

## Frontend Phase F3: Chat (Get ready + general styling)

**Goal:** 1.4, 1.8 in the UI.

**Backend contract (B2):**  
- `POST /api/conversations` → create; `GET /api/conversations` → `{ conversations, nextOffset }` (paginated).  
- `GET /api/conversations/:id` → one conversation; optional `includeMessages` returns messages with `role`, `content`, `imageUrl`, `imageUrls` (array), `flowType`, `flowContext` (parse JSON when string).  
- `POST /api/conversations/:id/messages` → body `{ message, imageUrl? }` (legacy) or `{ message, imageUrls? }` (array of image URLs); returns `{ reply, flowType?, flowContext?, messageId }`. When present, `flowContext` is `{ looks: [], products: [], tips: [], makeupHair: [] }`. Each look has `lookImageStyle`: `"flat_lay"` or `"on_model"` (for label/layout: “Flat lay” vs “Styled on model”). **Multi-image:** backend accepts multiple images per message via `imageUrls`; Styling Agent uses all for intent and first for validate_outfit.

| # | Deliverable | Details |
|---|-------------|---------|
| F3.1 | **Conversation / chat UI** | List conversations (use `nextOffset` for load more); open conversation; send message (+ optional image); display assistant reply and cards from `flowContext` (looks, products, tips, makeupHair). Parse `flowContext` from message history when it is a JSON string. |
| F3.2 | **Cards and actions** | Render look cards (use `lookImageStyle` to label or layout: “Styled on model” vs “Flat lay”), product cards, tips, makeup/hair cards. Links to product (e.g. handle), look, or internal navigation. |
| F3.3 | **Image upload in chat** | Attach one or more images to message (upload via `/api/user-images/upload`, then call `POST .../messages` with `{ message, imageUrl }` or `{ message, imageUrls: [url1, url2, ...] }`). |

**Depends on backend:** B2 (Conversation API, Styling Agent).

---

## Frontend Phase F4: Search and look planning

**Goal:** 2.1 search; 1.5 look planning in UI.

| # | Deliverable | Details |
|---|-------------|---------|
| F4.1 | **Search** | Search bar: call Search API (or conversation with search intent); display results (products; later microstores/brands). Refinement via follow-up in chat or search bar. |
| F4.2 | **Look planning** | Input occasion (e.g. vacation); call Look planning API; display planned looks (diversity + style). |

**Depends on backend:** B3 (Search Agent, product search); B5 (Look planning API).

---

## Frontend Phase F5: MicroStores, Store for you, brand zones

**Goal:** 2.2, 2.4, 2.3 in the UI.

| # | Deliverable | Details |
|---|-------------|---------|
| F5.1 | **MicroStore browse** | List microstores (personalized order); detail view (banner, style notes carousel, items). Follow/unfollow. |
| F5.2 | **Store for you** | Dedicated section: “Store for you” for current user; show cached microstore; refresh when stale. |
| F5.3 | **Brand zones** | List brand zones (personalized); detail view; follow brands. Brand search (NL). |

**Depends on backend:** B6 (MicroStore APIs); B7 (Brand Zone APIs).

---

## Frontend Phase F6: Personalization, content, preferences

**Goal:** Personalized experience; fashion content (trends/rules); wishlist and follow; fashion edit (reels) when backend is ready.

| # | Deliverable | Details |
|---|-------------|---------|
| F6.1 | **Personalization** | Landing page uses personalization API (which page to show). Listings (products, microstores, brands) already ordered by backend; ensure UI respects order. |
| F6.2 | **Fashion content (trends & rules)** | Display trends and styling rules from Fashion Content Service (blocks, carousels, or dedicated page). For system/agent use; auth required. |
| F6.3 | **Wishlist and follow** | Wishlist UI (add/remove, list); follow brands and microstores; optional “match to you” badges (if Match Agent exists). |
| F6.4 | **Fashion edit / Reels** | Scrollable feed of high-quality fashion content (videos, images) from Content Feed API (B9). Entertainment for users; posted by brands or admin. |

**Depends on backend:** B5 (Personalization); B1/B2 (Fashion Content); B7 (Preferences); B9 (Content Feed for F6.4).

---

## Frontend Phase F7: Brand admin

**Goal:** Brand users can manage zones and microstores and see analytics.

| # | Deliverable | Details |
|---|-------------|---------|
| F7.1 | **Brand admin UI** | Create/edit brand zone; create/edit microstore (select items within brand scope); submit for approval. |
| F7.2 | **Analytics view** | Consumer analytics compared to own brand (views, engagement). |

**Depends on backend:** B8 (Brand admin, Analytics).

---

# Part D: Phase summary and dependency order

## What we build: utility vs service vs agent vs API

| Type | Meaning | Examples |
|------|---------|----------|
| **utility** | Generic, reusable capability; no business logic; used by many agents/services | Image analysis (Vision), Image generation, LLM, Storage, Embeddings |
| **service** | Domain logic and data; no conversation; exposes functions/APIs | User Profile, Look Composition, Fashion Content, MicroStore, Personalization |
| **agent** | Orchestrates tools; generates and validates; conversational or batch | Router, Styling Agent, Look Analysis Agent, Fashion Content Agent |
| **API** | HTTP routes that expose services/agents to the frontend | Conversation API, Search API, Look analysis API |

Every backend deliverable in Part B is tagged with one of these types.

## Backend (build in this order)

| Phase | Name | Delivers (by type) |
|-------|------|--------------------|
| **B0** | **Utilities and generic services** | **utility**: Image analysis (Vision), Image generation (wrapper), LLM, Storage (ref), Embeddings (optional) |
| **B1** | Foundation (profile + fashion content) | **service**: User Profile, Fashion Content; **agent**: Fashion Content Agent; **API**: User Profile API |
| **B2** | Conversation and styling | **service**: Conversation, Look Composition; **agent**: Router, Styling Agent; **API**: Conversation API |
| **B3** | Profile enrichment + search | **agent**: User Profile Agent, Search Agent, Router (intent + routing to Styling vs Search); **service**: Product search (NL/semantic); **API**: Search API |
| **B4** | Fashion diary, style report, wardrobe extraction | **agent**: Look Analysis, Style Report, Wardrobe Extraction, Extend Router (diary/style report/wardrobe intents); **API**: look analysis, style report, wardrobe extraction |
| **B5** | Look planning + personalization | **agent**: Look Planning, Extend Router (look planning intent); **service**: Personalization; **API**: look planning, personalization hooks |
| **B6** | MicroStores + Store for you | **service**: MicroStore, search extension; **agent**: MicroStore Curation; **API**: MicroStore APIs |
| **B7** | Brand zones + preferences | **service**: Brand Zone, Preferences; **agent**: Match (optional), Extend Router (match intent, optional); **API**: brand zone, preferences |
| **B8** | Brand admin + analytics | **service**: Analytics; **API**: Brand admin APIs |
| **B9** | Content feed (Fashion edit) | **service**: Content Feed (FeedPost-backed); **API**: Content Feed APIs (list feed, get item; admin/brand create, approve) |

## Frontend (build after corresponding backend)

| Phase | Name | Depends on backend |
|-------|------|--------------------|
| **F1** | Auth, profile shell, app shell | Auth; optionally B1 |
| **F2** | Fashion diary, style report, wardrobe | Phase 3 + B4 |
| **F3** | Chat (Get ready + styling) | B2 |
| **F4** | Search + look planning | B3, B5 |
| **F5** | MicroStores, Store for you, brand zones | B6, B7 |
| **F6** | Personalization, content, preferences, fashion edit (reels) | B1, B2, B5, B7, B9 (for F6.4) |
| **F7** | Brand admin | B8 |

## Visual dependency (backend)

```
B0 (Utilities: Image analysis, Image gen, LLM, Storage, Embeddings)
  → B1 (Profile, Fashion Content services + Fashion Content Agent)
  → B2 (Conversation, Look Composition, Router, Styling Agent)
  → B3 (User Profile Agent, Product search, Search Agent)
  → B4 (Look Analysis, Style Report, Wardrobe Extraction agents)
  → B5 (Look Planning Agent, Personalization Service)
  → B6 (MicroStore Service, MicroStore Curation Agent)
  → B7 (Brand Zone, Preferences services; Match Agent)
  → B8 (Brand admin APIs, Analytics)
  → B9 (Content Feed Service, Fashion edit / reels APIs)
```

---

This document is the single place for (1) architecture summary including **utilities**, (2) backend phase plan with **B0 utilities** and **Type** (utility / service / agent / API) for every deliverable, and (3) frontend phase plan, with backend first and clear dependencies.