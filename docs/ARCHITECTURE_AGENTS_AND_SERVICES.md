# Architecture: Agents and services (full pass, aligned with Functionality.txt)

This document defines **agents** and **services** from the functionality in `Functionality.txt`. Agents **generate** and **validate**; services own data and composable logic. A thin router picks which agent handles a user turn. This revision incorporates: (1) Fashion content as **service + agent** that searches for and updates trends/rules; (2) User profile as **service with subsets** plus an **agent** that generates fashion need and fashion motivation; (3) a full pass over every functionality item for implementation clarity.

---

## Part 1: Design decisions (summary)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Get Ready + General Styling | **One agent: Styling Agent** | Single styling conversation surface; multiple modes (suggest looks/items, pairing, validation, trends, “will this look good?”). |
| Looks Builder | **Look Composition Service** (pure build) + **Styling Agent** (conversation) | Service builds one look from params; agent uses it when user wants looks/pairing/“how do I look”. |
| MicroStore | **MicroStore Curation Agent** (generate + validate) + **MicroStore Service** (persist, approve, follow, Store for you) | Agent figures topics, selects items, generates banner/notes, validates; service stores and serves. |
| **Fashion content** | **Fashion Content Service** (store, serve) + **Fashion Content Agent** (search, extract, update) | Service holds trends and styling rules; **agent** searches for latest trends and styling rules (LLM/sources), validates, and **updates** the service so content stays current (4.1). |
| **User profile** | **User Profile Service** (storage, aggregation, subsets) + **User Profile Agent** (generate need & motivation) | Profile is a **combination** of: style profile, user history, fashion need, fashion motivation. **Service** stores all and exposes getProfile. **Subsets**: style profile store, user history store, fashion need/motivation store. **Agent** generates (and refreshes) **fashion need** and **fashion motivation** from history + style profile + quiz; writes back via service. Style profile is produced by Style Report Agent; history is written by events/chats. |
| Every agent | **Generate + validate** | Agents produce artifacts and validate (coherence, intent, quality) before returning or writing. |

---

## Part 2: Functionality → implementation (full pass)

Every item from Functionality.txt is mapped to agents, services, and how they interact.

### 1. Styling and getting ready

| Id | Functionality | Agent(s) | Service(s) | Implementation notes |
|----|----------------|----------|------------|------------------------|
| 1.1 | Upload look (fashion diary); process, analyze, comment; autocategorize vibe/occasion/time; file & display; bulk/single | **Look Analysis Agent** | Looks API (existing) | Agent: vision/LLM → comment + vibe/occasion/time; validate tone & categories; persist look. Frontend: diary UI, bulk/single upload. |
| 1.2 | Style report: user images → report.json → style profile → render | **Style Report Agent** | **User Profile Service** (style profile subset) | Agent: process images, generate report.json + style profile fields; validate; write style profile into User Profile Service. Frontend: upload images, render report. |
| 1.3 | Digital wardrobe: extract from looks → closest items → suggest → user accepts → wardrobe | **Wardrobe Extraction Agent** | Wardrobe API (existing) | Agent: vision extract items → product search “closest items” → suggest; validate match quality. Accept writes to Wardrobe via API. |
| 1.4 | Get ready with me (suggest looks/items, pairing, styling, improvement, validate, makeup/hair; image or text; any entry point; “how do I look”) | **Styling Agent** | Look Composition Service, User Profile, Fashion Content | Agent: interpret intent → use Look Composition for looks, product search for items → generate reply + cards; validate fit to vibe/occasion. Single conversational agent. |
| 1.5 | Looks planning (e.g. vacation); diversity and style | **Look Planning Agent** | Look Composition Service | Agent: occasion + constraints → plan set of looks (diversity); use Look Composition per look; validate diversity/style. |
| 1.6 | Preferences: wishlist, follow brands/microstores; analyze wishlist match to you | Optional **Match Agent** (analyze match) | **Preferences Service** (wishlist, follow storage) | Service: store wishlist, follow brands/microstores. Optional agent: given profile + wishlist items, generate “match to you” analysis; validate. |
| 1.7 | User profile: style report + history + chats + quiz → style report outcome, history, fashion motivation, fashion need; use everywhere | **User Profile Agent** (generates need & motivation) | **User Profile Service** (storage, aggregation, subsets) | See Part 3 (User profile in detail). Service stores and serves; agent refreshes need/motivation. |
| 1.8 | General styling chat (“will this look good?”, trends) | **Styling Agent** | User Profile, Fashion Content Service | Same agent as 1.4; uses Fashion Content for trends, User Profile for context. |

### 2. Shopping and browsing

| Id | Functionality | Agent(s) | Service(s) | Implementation notes |
|----|----------------|----------|------------|------------------------|
| 2.1 | Find items: NL search (product/vibe/mood), NL search brands/microstores, “close to image”, search bar or chat, refine in chat | **Search Agent** | Product/brand/microstore search APIs | Agent: query (text or image) → search APIs → generate results + optional NL summary; validate relevance. Refinement = another turn. |
| 2.2 | MicroStores: vibe×trend×category, 20–40 items, banner, notes; admin/system gen; approval; follow; personalized order; brand/user creation | **MicroStore Curation Agent** | **MicroStore Service** | Agent: generate topics, items, banner, notes; validate coherence. Service: persist, approval, follow, personalized order; brand/user creation rules. |
| 2.3 | Brand zones: story, create/approve, default, follow, personalized order, NL search | — | **Brand Zone Service** | CRUD, approval, follow, ordering. Brand search can call Search Agent or dedicated search. |
| 2.4 | Store for you: per-user microstore from profile/style; refresh visit or 24h | **MicroStore Curation Agent** (invoked with userId/profile) | **MicroStore Service** (cache, refresh) | Service invokes agent with getUserProfile(userId); agent returns candidate; service caches and refreshes. |
| 2.5 | All listing and search personalized | — | **Personalization Service** | Input: profile + context; output: ordering/scores for products, brands, microstores, search. |

### 3. Personalization

| Id | Functionality | Agent(s) | Service(s) | Implementation notes |
|----|----------------|----------|------------|------------------------|
| 3 | Gender, landing, personalize listings/search/chat, wishlist/cart match, suggest via Store for you | — | **Personalization Service**, **User Profile Service** | Personalization uses profile (which includes need, motivation, style, history). Landing page choice, ordering, suggestions. |

### 4. Fashion content (functional) vs Fashion edit (entertainment)

| Id | Functionality | Agent(s) | Service(s) | Implementation notes |
|----|----------------|----------|------------|------------------------|
| 4.1 | Maintain fashion knowledge: trends (LLM-extract latest), styling rules; constantly updated | **Fashion Content Agent** | **Fashion Content Service** | **Agent**: searches for latest trends and styling rules (LLM, web, or internal); validates; **updates** Fashion Content Service. **Service**: stores and serves trends, styling rules only. Used by Styling Agent, MicroStore Curation, etc. — not for user-facing entertainment. |
| 4.2 | Fashion edit: high-quality fashion content (reels, videos, images) for users | — | **Content Feed Service** | **Separate from 4.1.** Entertainment content; posted by **brands or admin**. Service (e.g. FeedPost-backed): store & serve feed items; list feed, get item; admin/brand create, approve. No Fashion Content Agent. Frontend: scrollable reels / feed UI. |

### Brand

| Functionality | Agent(s) | Service(s) | Implementation notes |
|---------------|----------|------------|------------------------|
| Create brand zone, microstores, publish; consumer analytics | — | Brand Zone Service, MicroStore Service, **Analytics** | Admin/API for create/approve; analytics compared to own brand. |

---

## Part 3: User profile and Fashion content in detail

### User profile: service + subsets + agent

**User profile** (1.7) is a **combination** of:

- **Style profile** — From user images and inferences (Style Report Agent writes this).
- **User history** — Patterns and clickstream on products, plus chats (events pipeline and Conversation Service write this).
- **Fashion need** — **Generated** from data (history + style + context).
- **Fashion motivation** — **Generated** from data (history + style + context).
- (Quiz — explicit answers; stored when user submits.)

**User Profile Service** (storage + aggregation):

- **Subsets** (logical or physical):
  - **Style profile store** — Receives output from Style Report Agent; exposes as part of profile.
  - **User history store** — Events, clicks, chat summaries; used for aggregation and by User Profile Agent.
  - **Fashion need / fashion motivation store** — Generated fields; written by User Profile Agent, read by Personalization and agents.
- **Responsibilities**: Persist all of the above; aggregate into a single **user profile**; expose `getUserProfile(userId)` for agents and Personalization Service.
- **Writers**: Style Report Agent (style profile); event pipeline / Conversation (history); User Profile Agent (need, motivation); frontend/API (quiz).

**User Profile Agent** (generate + validate):

- **Inputs**: User history + style profile (from User Profile Service); optionally quiz; optionally Fashion Content for context.
- **Generate**: **Fashion need** and **fashion motivation** (LLM or structured pipeline).
- **Validate**: Coherence, consistency with history and style.
- **Output**: Writes updated need and motivation back to User Profile Service. Can run on schedule or when new history/style data arrives.
- **Does not**: Generate style profile (Style Report Agent); store raw history (events do that). It only generates and updates need and motivation.

So: **User profile** = **User Profile Service** (with subsets: style profile, history, need/motivation) + **User Profile Agent** (generates and refreshes need and motivation).

### Fashion content (4.1): service + agent

**Fashion Content Service** (store + serve):

- Stores: **trends** (latest fashions, trend names, descriptions); **styling rules** (e.g. “how to pair X with Y”). No entertainment content (see 4.2).
- Serves: Styling Agent, MicroStore Curation Agent, and any consumer that needs current trends/rules for functionality.
- **Does not** discover or update content by itself; it is updated by the Fashion Content Agent.

**Fashion Content Agent** (search + extract + update):

- **Inputs**: Schedule or on-demand; optional seed (e.g. “spring 2025”, “formal wear”).
- **Generate**: Searches for **latest trends** and **styling rules** (via LLM, web/sources, or internal); produces structured updates (trends, rules).
- **Validate**: Relevance, quality, “current enough”; filter noise.
- **Output**: **Updates** Fashion Content Service (write new/updated trends and rules). Keeps 4.1 “constantly updated”. Does **not** curate reels/videos (that is 4.2, Content Feed).

So: **Fashion content (4.1)** = **Fashion Content Service** (store, serve) + **Fashion Content Agent** (search for trends/rules, update service).

### Fashion edit / Content feed (4.2): service only

**Content Feed Service** (store + serve):

- Purpose: **Entertainment** content for users (reels, high-quality videos/images). Separate from Fashion Content (which is for agent/functionality).
- **Writers**: Brands, admin (post items; approval workflow). No Fashion Content Agent.
- Backed by existing FeedPost (or equivalent): type, title, media URL, caption, brandId, approval, etc.
- Serves: Frontend (fashion edit / reels UI). List feed, get item; admin/brand create and approve.

---

## Part 4: Agents (full list, generate + validate)

| Agent | Scope | Inputs | Tools | Generate | Validate | Output |
|-------|--------|--------|-------|----------|----------|--------|
| **Look Analysis Agent** | 1.1 | Look image(s), optional look id | Vision/LLM, Looks API | Comment; vibe/occasion/time | Comment tone; categories match image | Comment + categories; persist look |
| **Style Report Agent** | 1.2 | User images (refs) | Image processing, LLM, User Profile Service | report.json; style profile fields | Report complete; profile consistent | report.json; write style profile to User Profile Service |
| **Wardrobe Extraction Agent** | 1.3 | Look (image or id) | Vision, product search “closest items”, Wardrobe API | Suggested product IDs per slot | Match quality; no duplicates | Suggestions; accept → wardrobe |
| **Styling Agent** | 1.4, 1.8 | Message, optional image, conversation | Look Composition, product search, generate image, User Profile, Fashion Content, LLM | Reply; looks; items; pairing; tips; validation; makeup/hair | Reply matches intent; suggestions fit context | Reply + cards |
| **Look Planning Agent** | 1.5 | Occasion, constraints | LLM, product/look retrieval, Look Composition | Planned set of looks (diversity) | Diversity and style met | Structured plan |
| **User Profile Agent** | 1.7 (need & motivation) | History + style profile (+ quiz) from User Profile Service | LLM, User Profile Service (read/write) | Fashion need; fashion motivation | Coherent with history/style | Write need & motivation to User Profile Service |
| **MicroStore Curation Agent** | 2.2, 2.4 | Trigger (schedule or “Store for you” + userId); optional seed | Product search, Fashion Content, image generation, LLM | Topics; 20–40 items; banner; style notes | Topics coherent; selection quality; banner/notes match | Candidate microstore → MicroStore Service |
| **Fashion Content Agent** | 4.1 | Schedule or on-demand; optional seed | LLM, external/sources, Fashion Content Service (read/write) | Latest trends; styling rules | Relevance; quality; current | **Update** Fashion Content Service |
| **Search Agent** | 2.1 | Query (text or image), refinement | Product/brand/microstore search | Result set; optional NL summary | Relevance; refinement improves | Results + summary |
| **Router** | — | Message, conversation, image | — | — | — | Which agent to invoke |

---

## Part 5: Services (full list)

| Service | Scope | Responsibilities | Subsets / notes |
|---------|--------|-------------------|------------------|
| **User Profile Service** | 1.7 | Store and aggregate profile; expose getUserProfile(userId). Ingest: style profile (Style Report Agent), history (events, chats), need/motivation (User Profile Agent), quiz (API). | **Subsets**: style profile store, user history store, fashion need/motivation store. |
| **Look Composition Service** | 1.4, 1.5 | Pure build: vibe, occasion, constraints → one look (product list + optional image). No chat. | Used by Styling Agent, Look Planning Agent. |
| **MicroStore Service** | 2.2, 2.4 | Persist microstores; approval; list with personalized order; follow; “Store for you” (invoke MicroStore Curation Agent, cache, refresh). | — |
| **Personalization Service** | 2.5, 3 | Profile + context → ordering/scores for products, microstores, brands; landing page. | Uses User Profile. |
| **Brand Zone Service** | 2.3 | CRUD, approval, default zone, list with personalized order, follow. Brand search. | — |
| **Fashion Content Service** | 4.1 | **Store** and **serve** trends, styling rules only. **Updated by** Fashion Content Agent. | Read by Styling Agent, MicroStore Curation Agent. |
| **Content Feed Service** | 4.2 | **Store** and **serve** fashion edit feed (reels, videos, images). Posted by brands/admin; approval workflow. | Read by frontend (reels/feed UI). |
| **Preferences Service** | 1.6 | Wishlist, follow brands/microstores. Optional: match analysis (or small Match Agent). | — |
| **Conversation Service** | All chat | Persist conversation and messages; handleTurn → Router → one agent → persist reply → return. | — |

---

## Part 6: Generate & validate (principle)

Every agent that produces content or recommendations:

1. **Generate** — Produce the artifact (comment, report, need/motivation, look, microstore candidate, trends/rules update, search results, reply).
2. **Validate** — Check coherence, intent match, quality; optionally regenerate or filter.
3. **Return / write** — Return to user or write to service after validation (or defined fallback).

Router does not generate or validate.

---

## Part 7: Functionality → agent/service mapping (concise)

| Functionality | Agent | Service |
|---------------|-------|---------|
| 1.1 Fashion diary | Look Analysis Agent | Looks API |
| 1.2 Style report | Style Report Agent | User Profile Service (style profile) |
| 1.3 Digital wardrobe | Wardrobe Extraction Agent | Wardrobe API |
| 1.4 Get ready with me | Styling Agent | Look Composition, User Profile, Fashion Content |
| 1.5 Looks planning | Look Planning Agent | Look Composition |
| 1.6 Preferences, wishlist, follow, match | Optional Match Agent | Preferences Service |
| 1.7 User profile | **User Profile Agent** (need & motivation) | **User Profile Service** (style profile, history, need, motivation) |
| 1.8 General styling chat | Styling Agent | User Profile, Fashion Content |
| 2.1 Find items | Search Agent | Search APIs |
| 2.2 MicroStores | MicroStore Curation Agent | MicroStore Service |
| 2.3 Brand zones | — | Brand Zone Service |
| 2.4 Store for you | MicroStore Curation Agent | MicroStore Service |
| 2.5, 3 Personalization | — | Personalization Service |
| 4.1 Maintain trends/rules (constantly updated) | **Fashion Content Agent** (search, extract, update) | **Fashion Content Service** (store, serve) |
| 4.2 Fashion edit (reels, videos, entertainment) | — | **Content Feed Service** (brands/admin post) |
| Brand admin | — | Brand Zone, MicroStore, Analytics |

---

## Part 8: Backend vs frontend

| Responsibility | Backend | Frontend |
|----------------|---------|----------|
| Auth | Login, JWT, session | Login UI, token |
| Looks / fashion diary | Look Analysis Agent, Looks API | Diary UI, upload (bulk/single), display |
| Style report | Style Report Agent, User Profile | Upload images, render report |
| Wardrobe | Wardrobe Extraction Agent, Wardrobe API | Wardrobe UI, suggest list, accept/reject |
| Get ready + general styling | Styling Agent, Conversation | Chat UI, cards, image upload |
| Look planning | Look Planning Agent | Plan view, occasion input |
| User profile | User Profile Service, User Profile Agent | Profile/settings, quiz UI |
| Preferences | Preferences Service, optional Match Agent | Wishlist, follow buttons |
| Search | Search Agent | Search bar, results, chat refinement |
| MicroStores | MicroStore Curation Agent, MicroStore Service | Browse microstores, Store for you |
| Brand zones | Brand Zone Service | Browse brand zones |
| Personalization | Personalization Service | Landing, ordered lists |
| Fashion content (trends & rules) | **Fashion Content Service** (serve) + **Fashion Content Agent** (update) | Content blocks, trends, styling rules (for system/agents) |
| Fashion edit / Reels (4.2) | **Content Feed Service** | Scrollable reels, feed UI (entertainment; brands/admin post) |
| Brand admin | Brand Zone, MicroStore, Analytics | Brand admin UI |

---

## Part 9: Suggested build order (after Phase 3)

1. **User Profile Service** (with subsets: style profile, history, need/motivation) + schema.
2. **Fashion Content Service** (store/serve) + **Fashion Content Agent** (search for trends/rules, update service) — so Styling Agent and MicroStore have current content.
3. **Conversation Service** + **Router** (stub) + **Styling Agent** + **Look Composition Service** — end-to-end styling chat.
4. **User Profile Agent** — generate/refresh fashion need and fashion motivation from history + style profile.
5. **Search Agent** + product NL/semantic (and optionally image) search.
6. **Look Analysis Agent** — 1.1 fashion diary.
7. **Style Report Agent** — 1.2; writes style profile into User Profile Service.
8. **Wardrobe Extraction Agent** + “closest items” + accept.
9. **Look Planning Agent**.
10. **Personalization Service** — plug into listings and Store for you.
11. **MicroStore Curation Agent** + **MicroStore Service** (including “Store for you”).
12. **Brand Zone Service**.
13. **Preferences Service** + optional Match Agent.
14. **Brand admin** (create zones/microstores, approval, analytics).
15. **Content Feed Service** (Fashion edit / reels) — feed of high-quality content (videos, images); brands/admin post; FeedPost-backed; list feed, get item, approve. Frontend: scrollable reels UI.

This order: profile and fashion content (service + agent) early so other agents can depend on them; then conversation and styling; then profile enrichment (User Profile Agent); then remaining agents and services.
ok 