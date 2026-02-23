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
| B3.4 | **Search API** | API | e.g. `POST /api/search` or via conversation (Router can route to Search Agent). Expose search for search bar and chat. When user is authenticated, apply personalization (e.g. `scoreAndOrderProducts`) to product results so ordering uses user profile. |
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

**Backend status:** All backend phases **B0–B9** are implemented. Frontend consumes backend2 APIs only.

Frontend is built in **frontend2** (Next.js App Router, React 18, Tailwind, SWR). The existing `frontend` folder is reference only; no shared packages. Design and layout: desktop = wide landscape (horizontal nav, multi-column); mobile = vertical (single column, drawer or bottom nav). See `frontend2/docs/DESIGN_SYSTEM.md` and `Functionality.txt` for user/brand use cases.

---

## App navigation (current)

Primary navigation and entry points for the user app:

| # | Nav item | Route(s) | Content / functionality |
|---|----------|----------|---------------------------|
| 1 | **Find** | `/search` (and optional `/browse`) | Search: NL and image-based product/brand/microstore search; results and refinement. |
| 2 | **Brand** | `/brands` (user-facing) | Brand zones: list (personalized), detail, follow, brand search. (Brand **admin** at `/brand` for brand users.) |
| 3 | **Store** | `/microstores` | Microstores: list (personalized), detail (banner, style notes, items), follow. |
| 4 | **Looks** | `/looks` (hub) | Adding looks (fashion diary), Get ready with me (entry to styling), Style report. Tabs/sections: diary, style report, get-ready entry (can link to Concierge). |
| 5 | **Closet** | `/wardrobe` (hub) | Wardrobe (list, add from look); Wishlist; Cart; Store for you. Sections or tabs. |
| 6 | **Edit** | `/feed` | Content: Fashion edit / reels — scrollable feed from Content Feed API (B9). |
| 7 | **Profile** | `/profile` | Settings; add photos or avatar; take quiz or preferences; basic profile and User Profile data. |
| 8 | **Concierge** | `/concierge` | Chat: list conversations, open/create, send message (+ images), display reply and cards (looks, products, tips, makeup/hair). |

Header/nav and Concierge FAB (or nav link) are in `AppShell.tsx` and `AppHeader.tsx`; update nav items to match the routes above (Find → `/search`, Brand → `/brands` for users, Store → `/microstores`, Looks → `/looks`, Closet → `/wardrobe`, Edit → `/feed`, Profile → `/profile`, Concierge → `/concierge`).

**Frontend implementation order (all backend complete):** Build **Shared product UX** first (product tile, product modal, product detail page), then F2 (Concierge) → F3 (Find) → F4 (Looks) → F5 (Closet) → F6 (Store) → F7 (Brand) → F8 (Edit) → F9 (Profile) → F10 (Landing + personalization polish) → Brand admin.

---

## Shared product UX (tile, modal, detail page)

These three are **built once** and **reused everywhere** a product is shown. Implement them early (before or as part of F2/F3) so Browse, Search, MicroStores, Concierge cards, Wardrobe suggestions, Wishlist, and Store for you all use the same components and behavior.

### 1. Product tile card

- **One reusable component** (e.g. `ProductTile` or `ProductCard` in `frontend2/components/`).
- **Look:** Image (aspect-square or configurable), title (line-clamp-2), brand name, optional price; design tokens (card, border, radius, shadow); hover state (e.g. shadow-soft-hover).
- **Actions on tile (optional, by context):** Add to wishlist (heart icon), Add to cart (bag/cart icon). Show when the listing supports it (browse, search, microstore, Concierge cards, wardrobe suggestions, wishlist).
- **Click:** Whole tile (or image + title) opens the **product quick-view modal** (see below). Same behavior from every listing.

**Used in:** Browse (`/browse`), Search results (F3), MicroStore detail (F6), Store for you (F5), Concierge product cards (F2), Wardrobe suggested products (F5), Wishlist (F5).

### 2. Product modal (on click)

- **One quick-view modal** (e.g. `ProductQuickViewModal`). Same content and actions wherever a product tile is clicked.
- **Content:** Product image, title, brand, price, short description or key details; primary CTA “View full details” → navigates to product detail page (`/browse/[id]`).
- **Actions in modal:** Add to wishlist, Add to cart.
- **Behavior:** Desktop: click tile → open modal (no route change). Mobile: same modal (scrollable) or click tile → go straight to detail page; choose one and keep consistent. Optional: support `?product=id` (or hash) so “Open in new tab” / share lands on detail.

### 3. Product detail page

- **Route:** `/browse/[id]` (canonical product page).
- **Content:** Hero image or gallery, title, brand, price, full description (e.g. descriptionHtml), variants if any; Add to wishlist, Add to cart.
- **Relationship:** Modal = quick preview + actions + “View full details” → `/browse/[id]`. Detail page = full experience; no need to open the modal again from here.

**Key files:** `frontend2/components/ProductTile.tsx` (or `ProductCard.tsx`), `frontend2/components/ProductQuickViewModal.tsx`; `frontend2/app/(user)/browse/[id]/page.tsx`. Optionally document in `frontend2/docs/PRODUCT_UX.md`.

---

## Frontend: Design foundation (done)

Already implemented in frontend2.

| # | Deliverable | Details |
|---|-------------|---------|
| **Design system** | `tailwind.config.ts`, `globals.css`: Hanger tokens (typography, colors, spacing, radius, shadows). See `frontend2/docs/DESIGN_SYSTEM.md`. |
| **Responsive strategy** | Breakpoint `lg` (1024px). `frontend2/docs/RESPONSIVE_STRATEGY.md`. Desktop: horizontal nav; mobile: vertical, touch-friendly. |
| **App shell** | `AppShell.tsx`, `AppHeader.tsx`, `AppFooter.tsx`; `app/(user)/layout.tsx`. Header: logo, nav (Find, Brand, Store, Looks, Closet, Edit), user menu (Profile, logout). Concierge FAB or link to `/concierge`. |
| **Profile shell** | `/profile`: basic profile, placeholders for Style report, Quiz, Settings. Extended in Profile and Looks phases. |

---

## Frontend Phase F1: Auth and shell (done)

| # | Deliverable | Details |
|---|-------------|---------|
| F1.1 | **Auth UI** | Login; token storage; Bearer on API calls. |
| F1.2 | **Profile shell** | Basic profile (User Profile API); placeholders for style report, quiz, settings. |
| F1.3 | **App shell** | Nav, layout (mobile + desktop), routing; landing redirect by role. |

**Backend:** Auth; B1 (get profile).

---

### Phase F2: Concierge (Chat)

**Nav:** Concierge → `/concierge`. **Goal:** 1.4 Get ready with me + 1.8 general styling chat. **Backend (B2):** Conversation API; flowContext (looks, products, tips, makeupHair); lookImageStyle.

| # | Deliverable | Details |
| F2.1 | **Conversation / chat UI** | List conversations (nextOffset load more); new chat; open conversation; message list; send message (+ optional images); display assistant reply and flowContext cards. Parse flowContext when string. |
| F2.2 | **Cards** | Render look cards (label by lookImageStyle), product cards (link to `/browse/:id`), tips, makeup/hair. Use design tokens. |
| F2.3 | **Image upload in chat** | Attach one or more images (upload via user-images API); send with message as imageUrl or imageUrls. |

**Key files:** `app/(user)/concierge/page.tsx`, optional `concierge/[id]/page.tsx`; `lib/api/conversations.ts`. Render product cards from flowContext using shared **ProductTile** (or a compact variant) and **ProductQuickViewModal** so behavior matches the rest of the app.

---

### Phase F3: Find (Search)

**Nav:** Find → `/search`. **Goal:** 2.1 Find items — NL and image search; products (and microstores/brands). **Backend (B3):** Search API.

**Search bar in three places:** The same reusable search bar component is used on **Find** (`/search`), **Stores** (`/microstores`, F6), and **Brands** (`/brands`, F7). Each bar has: (1) text input, (2) an **image icon inside the bar** to attach an image (upload/paste). Placeholder is context-specific (no separate label):

- **Find:** "Search products by vibe, category, occasion or anything"
- **Store:** "Find microstores by trend, vibe or anything"
- **Brands:** "Discover brands you love by mood, style or anything"

**Personalization:** Search and ordering use user profile when authenticated. Backend applies personalization to product search results (e.g. `scoreAndOrderProducts` after search when `userId` present); frontend sends auth and does not reorder on client.

| # | Deliverable | Details |
|---|-------------|---------|
| F3.1 | **Search bar component** | Reusable component: variant (find / store / brands), text input + image icon inside bar, context-specific placeholder; used on Find now, Stores and Brands in F6/F7. |
| F3.2 | **Search UI (Find)** | Find page: Search bar (find placeholder); call Search API (text and/or image); display results (products grid; later microstores/brands). |
| F3.3 | **Refinement** | Refine via search bar or follow-up (link to Concierge for conversational refinement). |
| F3.4 | **Browse** | Keep or add `/browse` for product listing (personalized when B5 in use); link from Find (e.g. "Browse all products"). |

**Key files:** `components/SearchBar.tsx` (or `ContextSearchBar.tsx`); `app/(user)/search/page.tsx`; search API client. Use shared **ProductTile** and **ProductQuickViewModal**; call Search API (results are personalized by backend); do not reorder on client. See `frontend2/docs/F3_FIND_SEARCH_PLAN.md` for full F3 plan.


---

### Phase F4: Looks (Fashion diary, Style report, Get ready entry)

**Nav:** Looks → `/looks` (hub). **Goal:** 1.1 Fashion diary; 1.2 Style report; entry to Get ready with me. **Backend (B4):** Look analysis API; Style report API; B2 for Get ready (Concierge).

| # | Deliverable | Details |
|---|-------------|---------|
| F4.1 | **Fashion diary** | Upload look (single + bulk); call Look analysis API; display looks with comment and categories (vibe, occasion, time); file/browse as diary. |
| F4.2 | **Style report** | Upload user images; call Style report API; render report (report.json → styled view). |
| F4.3 | **Get ready entry** | Entry point from Looks to Get ready with me (e.g. link to Concierge or dedicated flow). |
| F4.4 | **Looks hub** | `/looks` page: tabs or sections for Diary, Style report, Get ready. |

**Key files:** `app/(user)/looks/page.tsx` (and optional sub-routes); API clients for look analysis, style report.

---

### Phase F5: Closet (Wardrobe, Wishlist, Store for you, Cart)

**Nav:** Closet → `/wardrobe` (hub). **Goal:** 1.3 Wardrobe; 1.6 wishlist; 2.4 Store for you; cart if backend supports. **Backend (B4, B6, B7):** Wardrobe CRUD, extract-from-look, accept-suggestions, suggest-for-item; Preferences (wishlist, follow); Store for you API.

| # | Deliverable | Details |
|---|-------------|---------|
| F5.1 | **Wardrobe** | List wardrobe; add from look: extract-from-look → slots with suggestions → Accept/Replace/Resuggest per slot → accept-suggestions. |
| F5.2 | **Wishlist** | Wishlist UI (add/remove, list); optional "match to you" (Match Agent). |
| F5.3 | **Store for you** | Section under Closet: show cached "Store for you" microstore; refresh when stale. |
| F5.4 | **Cart** | Cart UI if backend exposes cart APIs. |
| F5.5 | **Closet hub** | `/wardrobe` with sections or tabs: Wardrobe, Wishlist, Store for you, Cart. |

**Key files:** `app/(user)/wardrobe/page.tsx`; wardrobe, preferences, microstore API clients. Use shared **ProductTile** and **ProductQuickViewModal** for suggested products and wishlist. Use personalized Store-for-you API; do not reorder on client.

---

### Phase F6: Store (MicroStores)

**Nav:** Store → `/microstores`. **Goal:** 2.2 MicroStores — list (personalized), detail (banner, style notes, items), follow. **Backend (B6):** MicroStore APIs.

| # | Deliverable | Details |
|---|-------------|---------|
| F6.1 | **MicroStore list** | List microstores (personalized order); follow/unfollow. |
| F6.2 | **MicroStore detail** | Detail view: banner, style notes carousel, product list with links to `/browse/:id`. |

**Key files:** `app/(user)/microstores/page.tsx`, `app/(user)/microstores/[id]/page.tsx`. Use shared **ProductTile** and **ProductQuickViewModal** for microstore item lists. List API returns personalized order; do not reorder on client.

---

### Phase F7: Brand (Brand zones)

**Nav:** Brand → `/brands` (user-facing; brand admin remains `/brand` for brand users). **Goal:** 2.3 Brand zones. **Backend (B7):** Brand zone APIs.

| # | Deliverable | Details |
|---|-------------|---------|
| F7.1 | **Brand list** | List brand zones (personalized); follow. |
| F7.2 | **Brand detail** | Brand zone detail view; follow. |
| F7.3 | **Brand search** | Brand search (NL) from Find or within Brand area. |

**Key files:** `app/(user)/brands/page.tsx`, `app/(user)/brands/[id]/page.tsx`. Brand list API returns personalized order; do not reorder on client.

---

### Phase F8: Edit (Content feed / Fashion edit)

**Nav:** Edit → `/feed`. **Goal:** 4.2 High-quality fashion content (reels, videos, images). **Backend (B9):** Content Feed APIs.

| # | Deliverable | Details |
|---|-------------|---------|
| F8.1 | **Feed UI** | Scrollable feed (reels-style or list); list feed from Content Feed API; get item by id. |
| F8.2 | **Item view** | Full view or modal for a feed item (media, caption, brand). |

**Key files:** `app/(user)/feed/page.tsx`; feed API client.

---

### Phase F9: Profile (Settings, avatar, quiz, preferences)

**Nav:** Profile → `/profile`. **Goal:** Settings; avatar; quiz/preferences; User Profile integration. **Backend (B1, B7):** User Profile API; preferences; avatar upload if available.

| # | Deliverable | Details |
|---|-------------|---------|
| F9.1 | **Settings** | App and account settings. |
| F9.2 | **Avatar / photos** | Add or change profile photo. |
| F9.3 | **Quiz and preferences** | Take quiz; submit preferences; show in profile. |
| F9.4 | **Profile data** | Display style profile, fashion need/motivation (User Profile) where appropriate. |

**Key files:** `app/(user)/profile/page.tsx`; profile and preferences API clients.

---

### Phase F10: Landing and personalization polish

**Goal:** Landing page uses personalization; optional look planning. **Personalization elsewhere:** Implement **with each page** when building it — use the backend’s personalized list APIs (products, microstores, brands) and **do not reorder on the client**. F10 does not retrofit every listing; it covers landing and any cross-cutting ordering only. **Backend (B5):** Personalization API (landing choice, ordering); Look planning API.

| # | Deliverable | Details |
|---|-------------|---------|
| F10.1 | **Landing** | When user hits `/`, call personalization API to decide which page to show (e.g. browse, feed, Store for you). |
| F10.2 | **Listings** | Ensure each listing built in F3/F5/F6/F7 uses the correct personalized API and does not re-sort results on the client. (Verify; most work is already done per phase.) |
| F10.3 | **Look planning** | Optional: input occasion (e.g. vacation); call Look planning API; display planned looks. (Can live under Looks or Concierge.) |

---

### Brand admin (separate from user nav)

**Goal:** Brand users manage zones and microstores and see analytics. Not part of the 8 user nav items. **Backend (B8):** Brand admin APIs; analytics.

| # | Deliverable | Details |
|---|-------------|---------|
| | **Brand admin** | Create/edit brand zone; create/edit microstore (items in brand scope); submit for approval; analytics view. |

**Key files:** `app/brand/page.tsx` (existing); role-based redirect from home.

---

# Part C+: Find Page Replan (fast load, diversity, preference graph)

**Goal:** Fast first load for Find, default list = mix of brands/categories, personalized listing when profile exists, backed by a Preference Graph that balances "what they like" with complementary categories (e.g. not only t-shirts if they wishlisted t-shirts).

## Does this approach make sense?

**Yes.** The direction is sound:

- **Fast default** — First load should not wait on full profile + 6 DB round-trips; a diversity-only list is fast and still engaging.
- **Default = mix of brands/categories** — Page 1 should show variety (different brands and category types). That's a better anonymous/default experience and avoids "everything looks the same."
- **Personalization when profile exists** — Use motivation, needs, history, style, cart, wishlist, followed brands. Today we use profile + follows + recent events but **not** cart/wishlist; adding them and structuring them via a preference graph is the right move.
- **Preference graph** — A single structure (brands, categories, vibes, occasions) derived from profile + wishlist + cart + history + follows, with **complementary** logic so we don't over-show one category (e.g. wishlisted t-shirts → also emphasize trousers, shoes, accessories). That gives both "match to you" and "balanced, outfit-level" selection.

## Why the Find page is slow today

Every `GET /api/products` does: optionalAuth (getUser) → listProducts → getPersonalizationContext (getUserProfile + brandFollows + microFollows + recentEvents 100 + find_visit count) → scoreAndOrderProducts. So **6+ DB round-trips** when authenticated, plus scoring and diversity. That explains slow first load.

## Target architecture (high level)

- **Fast path (default)** — No profile/preference load. Return a **diversity-first** product list (mix of brands and categories) from one or two cheap DB queries. Same for anonymous and for first paint when logged in.
- **Personalized path** — When user is authenticated and we want personalized order: use a **Preference Graph** (stored, updated async) so we do **one light read** (graph + listProducts), then score and apply **balanced mix** (complementary categories). No full getUserProfile + 100 events on the hot path.
- **Preference Graph** — Built from: style profile, need/motivation, history (viewed products), wishlist, cart, followed brands. Output: preferred and complementary brands/categories/vibes/occasions. Stored per user and updated when profile, wishlist, or cart changes (or periodically).

## 1. Fast first load

**Goal:** First response for Find is fast (target: <200ms server time for default list).

**Recommendation:** **Option B for immediate speed** — Two paths: `GET /api/products` = fast diversity-only (no getPersonalizationContext); `GET /api/products?personalized=1` when authenticated = full personalization. Then evolve to **Option C** once Preference Graph exists (single request, graph-based personalization when auth'd).

**Concrete steps (Option B):**

- **Default (fast) list:** `GET /api/products` returns **diversity-ordered** list only: listProducts → orderByDiversityOnly (round-robin by category_lvl1 | brandId). No profile, no recent events, no wishlist/cart reads.
- **Personalized list:** `GET /api/products?personalized=1` when authenticated: getPersonalizationContext (or later Preference Graph) + listProducts → scoreAndOrderProducts + balanced diversity. Frontend: first request without `personalized` for fast paint; if logged in, optionally request with `?personalized=1` and replace or use for next page.

## 2. Default list = mix of brands and categories

- After `listProducts(limit, offset)`, apply **diversity-only** ordering: reuse `diversityGroupKey(item) = category_lvl1 | brandId` and round-robin across groups (e.g. `orderByDiversityOnly(items)` or diversifyOrderBrowse with flat scores). No scoring, no profile. Each page stays mixed; pagination unchanged.

## 3. Preference Graph

**Contents:** Preferred brandIds, categories, mood_vibe, occasion_primary (from profile, wishlist, cart, follows, recent history). **Complementary:** For each preferred category (e.g. Shirts), add weights for "goes with" categories (Trousers, Jeans, Shoes, Accessories). Stored per user (new table or JSON on UserProfile). **Build (async):** On profile/wishlist/cart change or periodically; reads profile, listWishlist, listCartItems, follows, last K UserEvents; aggregates product attributes; applies complementary rules; writes graph. **Use:** scoreAndOrderProducts (or scoreAndOrderProductsWithGraph) uses graph for scoring + **category caps** and **complementary boosts** so the list is balanced.

## 4. Personalization when profile exists

**Sections to feed into the graph:** Style profile, motivation/needs, history, **cart**, **wishlist**, followed brands. **Balanced mix:** Preference graph holds complementary category weights; scoring enforces caps per category (e.g. max 30% from one category_lvl1) and boosts complementary categories so we don't over-show only wishlisted categories (e.g. show trousers/shoes if they wishlisted t-shirts).

## 5. Implementation order (phased)

| Phase | Scope |
|-------|--------|
| **Phase 1** | Fast load + default diversity: products route returns diversity-only when `personalized != 1`; frontend first request without `personalized`; add `orderByDiversityOnly` in personalization. When `personalized=1` and auth, keep current getPersonalizationContext → scoreAndOrderProducts. |
| **Phase 2** | Preference Graph: schema (UserPreferenceGraph or JSON on UserProfile); buildPreferenceGraph(userId); complementary rules; trigger on wishlist/cart/profile update or cron. |
| **Phase 3** | Personalization uses graph: getPreferenceGraph(userId) on personalized path; scoring with category caps and complementary boosts; optionally single request with graph when auth'd (Option C). |
| **Phase 4** | Frontend polish: fast path by default; optional "Personalized for you" re-fetch when logged in. |

## 6. Files to touch (summary)

- **backend2/src/routes/products.js** — Fast path when `personalized != 1`; diversity-only order; when `personalized=1` and auth, existing or graph-based scoring.
- **backend2/src/domain/personalization/personalization.js** — Add `orderByDiversityOnly(items)`; later `scoreAndOrderProductsWithGraph` with category caps and complementary weights.
- **New: backend2/src/domain/preferences/preferenceGraph.js** (or under personalization) — Build and read Preference Graph; complementary rules; write to DB.
- **DB migration** — UserPreferenceGraph table or column on UserProfile.
- **frontend2/app/(user)/browse/page.tsx** and **frontend2/lib/api/products.ts** — First request without `personalized`; optional `?personalized=1` when logged in.
- **Wishlist/Cart mutations** — Trigger preference graph rebuild (async or inline).

## 7. Risks and mitigations

- **Stale graph:** Rebuild on key actions or short TTL; daily rebuild acceptable for v1.
- **Complementary rules:** Start with static config map; later derive from co-views or look composition.
- **Two requests (fast + personalized):** Phase 1 only; Phase 3 can move to single request using graph for auth'd users.

---

# Part D: Improve the concierge experience

**Goal:** Make the concierge the best-in-class entry point for styling, get-ready, and fashion help by combining **LLM quality**, **fashion context** (trends, styling rules, product/look data), **user profile** (style, preferences, history), and a **great visual experience**. This section is about continuous improvement of the concierge: tone, flows, problem-solving, personalization, and visuals.

**Principles:** Use the best of (1) **LLM** — natural, helpful, on-brand tone and reasoning; (2) **Fashion context** — Fashion Content Service, product/look retrieval, styling rules; (3) **User profile** — style profile, goals, preferences, history; (4) **Visual experience** — rich cards (looks, products, tips), images, layout, and optional embedded flows from other sections (Looks, Fashion diary, etc.).

---

## D.1 User profile generation and use (review and improve)

**Goal:** Look at and improve **user profile generation** and its **use across different scenarios** so the profile is accurate, complete, and consistently applied in Concierge, Find, personalization, and settings.

| # | Deliverable | Type | Details |
|---|-------------|------|---------|
| D.1.1 | **Profile sources and gaps** | process + service | Clarify and document: style profile from Style Report (images) vs legacy profileJson (wishlist/cart/wardrobe); when each is used. Ensure history (clickstream, find_visit) is captured and optionally summarized. Populate or trigger history summary where useful (e.g. job or agent that calls `setHistorySummary`). |
| D.1.2 | **Fashion need and motivation** | agent + API | User Profile Agent (need/motivation) today runs only when POST `/api/profile/generate-need-motivation` is called. Add a trigger strategy: e.g. on login, after N find visits, or periodic job so need/motivation are generated for active users. Expose in profile API and Concierge prompt. |
| D.1.3 | **Profile use in scenarios** | agent + service | Ensure the same user profile (style, history, need, motivation, quiz) is passed and used in: Concierge (Styling Agent), Find/personalized listing (B5), Look planning, Style report, and Profile/settings (F9). Document which fields each scenario uses; fix gaps (e.g. empty profile in Concierge, or personalization ignoring need/motivation). |
| D.1.4 | **Overall profile consistency** | process | Optional: define an “overall summary” or one-line view of the user for UI or prompts if useful. Otherwise ensure the composite profile (style + history + need + motivation + quiz) is the single source of truth and all consumers read from User Profile Service. |

**Outcome:** User profile is generated from the right sources (images, legacy, events); history summary and need/motivation are populated where appropriate; profile is used consistently in Concierge, Find, look planning, and settings.

**Implementation:** User Profile Service and USER_PROFILE_SOURCES_AND_GAPS.md; User Profile Agent trigger (cron or on-event); Styling Agent, personalization, and Look planning reading from `getUserProfile()`; optional `setHistorySummary` job.

---

## D.2 Small talk and chattiness

Improve how the concierge handles casual or ambiguous messages so the experience feels warm and engaging, then transitions smoothly to intent and actionable help.

| # | Deliverable | Type | Details |
|---|-------------|------|---------|
| D.2.1 | **Small-talk detection and response** | agent + prompt | Detect greeting, thanks, “how are you”, vague opener. Respond in avatar tone; avoid product/trend cards until intent is clear. Keep one clarifying question or short follow-up when appropriate. |
| D.2.2 | **Chattiness and tone tuning** | prompt + config | Per-avatar personality (e.g. warm, concise, playful). System prompt and few-shot examples that balance friendly vs efficient. Optional: configurable “verbosity” or tone preset in user/profile or avatar. |
| D.2.3 | **Intent clarification** | agent | When message is ambiguous (e.g. “help me”, “what do you think?”), ask one focused clarifying question; then route to styling / search / look planning / diary / etc. once intent is clear. |

**Outcome:** Concierge feels conversational and on-brand; no premature product/trend dumps on small talk; smooth handoff to structured flows.

**Implementation:** Styling Agent (and Router) prompts; `isSmallTalk` / intent logic; avatar personality (e.g. `goalsAddition`, `preferencesOverride` in StylingAvatar). Test with greeting-only, thanks-only, and vague-first messages.

---

## D.3 Concierge flows: direct vs embedded

Test and support different **entry points** and **flows** so the same concierge capability can be used from the main Concierge chat and from other sections (Looks, Fashion diary, Get ready, etc.) with consistent quality and appropriate context.

| # | Deliverable | Type | Details |
|---|-------------|------|---------|
| D.3.1 | **Direct Concierge flow** | frontend + API | Current: user opens `/concierge`, chats with full context. Ensure conversation title, message blocks (text + cards), and avatar persistence work well. |
| D.3.2 | **Embedded / contextual flows** | frontend + API | From **Looks** (e.g. “Get ready” from diary or style report): open Concierge with pre-filled context (e.g. “I just added this look” or “Help me get ready for the occasion from my style report”). From **Fashion diary**: “Suggest looks for this vibe” or “What would pair with this?”. Backend: optional `context` or `source` in conversation create or first message so Styling Agent can tailor reply. |
| D.3.3 | **Flow comparison and testing** | process | Document and test: (a) direct Concierge only, (b) Concierge opened from Looks with occasion/vibe, (c) Concierge opened from diary with look image, (d) Concierge from Find (e.g. “Refine my search”). Measure: relevance of first reply, time to actionable result, user clarity. |

**Outcome:** One concierge backend, multiple front-end entry points; contextual prompts improve first-turn relevance when coming from Looks, diary, or Find.

**Implementation:** Conversation API: optional `source`, `prefillMessage`, or `metadata.entryPoint`; Styling Agent reads context and tailors system message or tools (e.g. prioritize look composition when entry is “get ready from looks”). Frontend: deep links or open Concierge with prefilled message/context from Looks, diary, Find.

---

## D.4 Problem solving and scenario coverage

Improve the quality and reliability of concierge outputs across a wide range of questions and scenarios so users get **great answers** and actionable results (looks, products, tips) when they need them.

| # | Deliverable | Type | Details |
|---|-------------|------|---------|
| D.4.1 | **Scenario matrix** | process | List key scenarios: get-ready (occasion/vibe), “what to wear for X”, trend ask, product find, look planning, “what goes with this”, style advice, follow-up refinement, multi-turn. For each: expected behavior, tools to call, and success criteria (reply quality, cards relevance). |
| D.4.2 | **Prompt and tooling improvements** | agent | Refine Styling Agent (and Router) prompts for clarity, tool choice, and output structure. Ensure User Profile, Fashion Content (trends, rules), product search, and Look Composition are used in the right combinations per intent. Add or tune few-shot examples for hard cases (e.g. vague request, very specific occasion, “no preference”). |
| D.4.3 | **Validation and fallbacks** | agent | When tools fail or return empty (e.g. no products, no looks), reply with helpful text and optional generic tips; avoid blank or broken cards. Retry or alternative tool paths where useful. |
| D.4.4 | **Quality checks and iteration** | process | Periodic review of sample conversations (direct + embedded); tune prompts and routing based on failures or weak answers. Optional: lightweight logging of intent + tools used for analysis. |

**Outcome:** Concierge gives relevant, complete answers and cards across get-ready, trends, search, look planning, and style advice; graceful fallbacks when data is missing.

**Implementation:** Styling Agent, Router, intent logic; Fashion Content and User Profile consistently in prompts; flowContext always populated when tools return data; tests or manual scenario runs for top 10–15 flows.

---

## D.5 Personalization and fashion settings

Ensure **personalization** and **fashion settings** are correct and used consistently so every concierge reply respects the user’s profile, goals, and preferences.

| # | Deliverable | Type | Details |
|---|-------------|------|---------|
| D.5.1 | **User profile in concierge** | agent + service | Styling Agent always receives relevant User Profile: style profile, fashion need/motivation, preferences, recent history. Prompt includes a clear “user profile” block; avatar preferences (if any) override or supplement. |
| D.5.2 | **Fashion settings and content** | agent + service | Fashion Content (trends, styling rules) is up to date and queried when intent is trends or style advice. Product and look retrieval use personalization (e.g. B5 ordering) when available. No client-side reordering of backend-personalized results. |
| D.5.3 | **Settings surface** | frontend | Profile/settings: user can view and edit fashion-related preferences (e.g. style quiz, goals, occasions they care about). Concierge avatars and tone (if configurable) are consistent with these settings. |

**Outcome:** Every concierge response is personalized; fashion content and profile are the single source of truth; settings are visible and editable.

**Implementation:** B1 User Profile API and B5 personalization; Styling Agent prompt construction (profile + fashion content); frontend Profile (F9) and Concierge avatar/profile wiring.

---

## D.6 Visual experience: LLM + fashion context + user profile

Combine **LLM**, **fashion context**, and **user profile** into a **great visual experience**: rich, scannable replies and cards that feel cohesive and on-brand.

| # | Deliverable | Type | Details |
|---|-------------|------|---------|
| D.6.1 | **Structured reply and cards** | backend + frontend | Assistant reply: clear text block plus optional flowContext (looks, products, tips, makeup/hair). Backend returns structured flowContext; frontend renders separate blocks (text bubble, then card section) with design tokens. Look cards show image (on-model or flat lay), label, optional products; product cards use shared ProductTile and link to detail. |
| D.6.2 | **Images and media** | backend + frontend | Look images (generated or from diary) displayed in cards; product images from catalog. Consistent aspect ratios and loading states; optional lazy load for long card lists. |
| D.6.3 | **Consistency and polish** | frontend | Typography, spacing, and colors follow design system; empty states and errors are friendly; conversation list and thread layout work on mobile and desktop. |

**Outcome:** Users see a clear, visually rich response: prose plus actionable cards (looks/products/tips) that reflect their profile and the best available fashion context.

**Implementation:** Conversation API flowContext shape; Styling Agent and Look Composition (image generation) producing URLs; frontend Concierge page (message blocks, FlowContextCards, ProductTile, look cards); design system and responsive strategy (Part C).

---

## D.7 Search experience improvement

**Goal:** Improve the Find/search experience with image-based search, refinements, and both semantic and direct search so users can discover products effectively.

| # | Deliverable | Type | Details |
|---|-------------|------|---------|
| D.7.1 | **Search with images** | backend + frontend | Allow users to search by uploading or pasting an image (e.g. “find something like this”). Backend: image embedding or vision-based query; product retrieval by visual similarity. Frontend: image upload/paste in search; results ranked by visual match. |
| D.7.2 | **Search with refinements** | backend + frontend | Support refinements (filters/facets) on search results: category, color, price band, brand, etc. Backend: filter params in search API; efficient filtered queries. Frontend: refinement UI (chips, sidebar, or inline) that updates results without losing search context. |
| D.7.3 | **Semantic and direct search** | backend + service | Combine **semantic search** (NL query → embedding, similarity over product embeddings) with **direct search** (keyword/match on title, tags, attributes). Rank or blend results so both “blue party dress” and exact product names work well. Expose in Search API and Find. |

**Outcome:** Users can search by image, refine results by filters, and get good results from both natural-language and keyword-style queries.

**Implementation:** Search API (B3) and product embeddings; optional vision/embedding for query image; refinement params and UI in Find (F3).

---

## Part D summary: implementation order

| Order | Focus | Main deliverables |
|------|--------|-------------------|
| 1 | **D.1** | User profile generation and use: sources/gaps, history summary, need/motivation triggers, profile use in Concierge, Find, look planning, settings. |
| 2 | **D.2 + D.5** | Small talk/chattiness; intent clarification; user profile and fashion settings wired into concierge. |
| 3 | **D.4** | Scenario matrix; prompt and tooling improvements; validation and fallbacks; quality iteration. |
| 4 | **D.3** | Embedded flows (Looks, diary, Find); context/source in API; frontend entry points and testing. |
| 5 | **D.6** | Visual polish: structured reply + cards, images, design consistency. |
| 6 | **D.7** | Search experience: search with images, search with refinements, semantic and direct search. |

**Dependencies:** Backend B0–B2 (Conversation, Styling Agent, Look Composition); B1 (User Profile); B3 (Search); B4 (Look analysis, Style report); B5 (Look planning, Personalization). Frontend: F2 Concierge, Shared product UX, Design foundation (done). Part D can be done incrementally; **D.1 (user profile generation and use) is the recommended first step**, then D.2 and D.5.

---

# Part E: Phase summary and dependency order

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

## Frontend (build after corresponding backend; all backend B0–B9 complete)

| Phase | Nav area | Name | Backend |
|-------|----------|------|---------|
| **Design foundation** | — | Tokens, responsive, App shell, Profile shell | None (done) |
| **F1** | Profile (shell) | Auth, profile shell, app shell | Auth; B1 (done) |
| **Shared product UX** | — | Product tile, product modal, product detail page (build once, reuse in F2–F7) | Products API |
| **F2** | Concierge | Chat (Get ready + styling) | B2 |
| **F3** | Find | Search; browse | B3 |
| **F4** | Looks | Fashion diary, style report, get-ready entry | B4, B2 |
| **F5** | Closet | Wardrobe, wishlist, Store for you, cart | B4, B6, B7 |
| **F6** | Store | MicroStores | B6 |
| **F7** | Brand | Brand zones (user-facing) | B7 |
| **F8** | Edit | Content feed / Fashion edit (reels) | B9 |
| **F9** | Profile | Settings, avatar, quiz, preferences | B1, B7 |
| **F10** | — | Landing (personalization API); personalization with each page (use APIs, no client reorder); optional look planning | B5 |
| **Brand admin** | (separate) | Brand zone + microstore management, analytics | B8 |

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

This document is the single place for (1) architecture summary including **utilities**, (2) backend phase plan with **B0 utilities** and **Type** (utility / service / agent / API) for every deliverable, (3) frontend phase plan with backend first and clear dependencies, and (4) **Part D: Improve the concierge experience** — user profile generation and use, small talk, flows (direct vs embedded), problem solving, personalization/fashion settings, visual experience, and search experience improvement (image search, refinements, semantic and direct search).