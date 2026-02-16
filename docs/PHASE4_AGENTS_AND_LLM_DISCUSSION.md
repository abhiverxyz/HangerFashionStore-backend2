# Phase 4: Agents and LLM user interactions – discussion

This doc lists **all agents and LLM-driven user interactions** we might implement in Phase 4 (backend2). Use it to decide, step by step, what to build and how.

---

## 1. Current picture (from existing backend)

The existing backend has:

- **Single conversation entry:** One API that receives a user message and returns an assistant reply. It:
  - Loads/creates conversation and appends messages
  - Decides: **action** (refine/swap/undo/explain) vs **flow** (numbered flows) vs **open conversation**
  - For open conversation, routes through **SuperAgent**, which then routes to specialized agents

- **SuperAgent (router):**
  - Can run in **agentic mode** (AgenticSuperAgent: goal → plan → tools → execute) or **regular mode**
  - Regular mode: intent detection → map to **agent type** + **flow key** → call the right agent/flow
  - **Agent types:** `looks_builder`, `shopping_assistant`, `personal_style`, `styling_assistant` (default)

- **Specialized agents / flows:**
  - **Looks Builder** — subIntents: 1a (product pairing), 1b (inspiration/vibe looks), 1c (full look from product). Uses product retrieval, image generation, turn composer.
  - **Shopping Assistant** — subIntents: 2a (direct product search), 2b (vibe/occasion), 2c, 2d. Multi-step flows (needs → candidates → stylist → decision → confirm).
  - **Personal Style** — subIntents: 3a, 3b, 3c, 3d (style analysis, makeover, image upload). Can ask for user image, then analyze and suggest looks.
  - **Styling Assistant** — general styling chat when nothing else fits.

- **Actions (within a flow/conversation):**
  - Refine, swap, undo, redo, explain — each has handlers that get current context and call product/flow logic.

- **Interpretive intents (what the user wants, not which flow):**
  - e.g. `vibe_based_shopping`, `similar_items_search`, `direct_product_search`, `style_inspiration`, `personal_style_analysis`, `product_pairing`, `clarification`.  
  - These are mapped to **agent type + flow key** (e.g. shopping + 2a, looks + 1b).

---

## 2. Proposed list for Phase 4 (to discuss step by step)

Below are **candidate agents and LLM user interactions** for backend2. We can keep, drop, or simplify each.

### A. Conversation and routing

| # | Item | Description | Discuss |
|---|------|-------------|--------|
| A1 | **Conversation API** | Single entry: `POST /api/conversations/:conversationId/messages` (or similar). Body: `{ message, imageUrl? }`. Returns assistant reply and optional cards/flow state. | Scope: create vs list conversations; auth; conversation ownership. |
| A2 | **Conversation persistence** | Store `Conversation` and `ConversationMessage` (already in Prisma). Load last N messages for context. | How many messages to include in context; metadata (flowType, flowContext). |
| A3 | **Router (SuperAgent light)** | Given `(userId, message, conversationHistory, imageUrl?)`, decide: **action** vs **flow** vs **open**. For open: which agent (looks / shopping / personal style / general). | Rule-based vs LLM-based routing; clarify vs no clarify. |
| A4 | **Agentic vs regular** | Optional: full AgenticSuperAgent (goal → plan → tools) vs simpler “intent → single agent” only. | Start with regular only, or support both behind a flag. |

### B. Agents (specialized)

| # | Item | Description | Discuss |
|---|------|-------------|--------|
| B1 | **Looks Builder** | User wants to create outfits/looks (from product, from vibe, or pair items). Uses: product search, Phase 3 image generate, optional wardrobe/looks. | Flows: 1a / 1b / 1c or one simplified “build look” flow. |
| B2 | **Shopping Assistant** | User wants to find/buy products (by query, by vibe/occasion, similar to image). Multi-step: need → candidates → rank → confirm. | How many steps; use flow2a/2b only or full 2a–2d. |
| B3 | **Personal Style** | User wants style analysis or makeover (e.g. upload photo, get advice/looks). May ask for image upload. | 3a/3b/3c/3d or one “style advice + optional image” flow. |
| B4 | **General / Styling Assistant** | Fallback: general fashion/styling chat when intent doesn’t match above. | Pure LLM reply or still call product/looks when relevant. |

### C. Flows (multi-turn, structured)

| # | Item | Description | Discuss |
|---|------|-------------|--------|
| C1 | **Flow 1a – Product pairing** | “Pair with this product” → get product, find complements, optionally generate look image. | Keep as-is, simplify, or merge into “Looks Builder” single flow. |
| C2 | **Flow 1b – Vibe/occasion looks** | “Looks for a wedding” → inspiration looks, maybe generate image. | Same as above. |
| C3 | **Flow 1c – Full look from product** | One product → full outfit suggestion + optional image. | Same. |
| C4 | **Flow 2a – Direct product search** | Need → validation → search → candidates → stylist → decision → confirm. | Keep full state machine or shorten (e.g. search → rank → reply). |
| C5 | **Flow 2b – Vibe/occasion shopping** | Shop by occasion/vibe; similar structure to 2a. | Same. |
| C6 | **Flows 2c / 2d** | Other shopping variants (e.g. similar items, trends). | Include or defer. |
| C7 | **Flow 3a/3b/3c/3d – Personal style** | Style analysis, makeover, image upload, suggest looks. | One “personal style” flow vs four. |

### D. Actions (within a turn)

| # | Item | Description | Discuss |
|---|------|-------------|--------|
| D1 | **Refine** | “Make it more casual”, “different color” → re-run search/flow with new constraints. | Same as backend: normalize context, call product/flow, return new cards. |
| D2 | **Swap** | “Swap the shirt” → replace one item, keep rest. | Same. |
| D3 | **Undo / Redo** | Revert or re-apply last change. | Needed in Phase 4 or later? |
| D4 | **Explain** | “Why this?” → LLM explanation of current suggestion. | Keep. |

### E. LLM usage (where we call the model)

| # | Item | Description | Discuss |
|---|------|-------------|--------|
| E1 | **Intent / interpretive intent** | Classify message: shopping vs looks vs personal style; or finer (2a vs 2b, 1a vs 1b). | One LLM call for routing vs rule-based + optional LLM. |
| E2 | **Need extraction (shopping)** | From message, extract “what they’re looking for” (category, occasion, style). | Keep for 2a/2b. |
| E3 | **Turn composer / reply** | Given context (products, flow state), generate natural-language reply and optional structured payload (cards, buttons). | Single “compose reply” call per turn. |
| E4 | **Stylist evaluator / ranker** | Score or rank products for “fit” to user need. | Keep or simplify to product ranking only. |
| E5 | **Goal setter (agentic)** | Only if we keep AgenticSuperAgent: set goal from message. | Defer or include. |
| E6 | **Clarification** | When intent is ambiguous (e.g. “shopping vs looks”), generate clarification question. | One LLM call or template. |

### F. Data and infra

| # | Item | Description | Discuss |
|---|------|-------------|--------|
| F1 | **User context** | Profile, style profile, preferences for personalization. | What we have in backend2 (User, etc.); what to pass into agents. |
| F2 | **Product retrieval** | Search and semantic retrieval for agents (backend2 product domain + optional embeddings). | Same API for conversation as for browse. |
| F3 | **Image generation** | Phase 3: `POST /api/generate/image`. Agents call this when a flow needs a generated look image. | No change; just usage from agents. |
| F4 | **Looks / wardrobe / user images** | Phase 3 APIs. Agents may read or create looks/wardrobe when building outfits or analyzing style. | Which agents touch which; permissions. |

---

## 3. Suggested order for discussion

1. **Conversation API and persistence (A1, A2)** — How users start/continue a chat; what we store.
2. **Router (A3, A4)** — How we decide “which agent” and “action vs flow vs open”.
3. **One agent at a time (B1 → B2 → B3 → B4)** — For each: scope (which flows), and whether we port, simplify, or rebuild.
4. **Flows (C1–C7)** — Which flows we keep and how many steps.
5. **Actions (D1–D4)** — Refine, swap, undo, explain: which in Phase 4.
6. **LLM touchpoints (E1–E6)** — Where we call the LLM and with what prompts.
7. **Data (F1–F4)** — User context, product retrieval, Phase 3 usage.

---

## 4. Execution after discussion

After we align on the list above we can:

- Define a **Phase 4 execution plan** (order of implementation, e.g. conversation API → router → Looks Builder → Shopping → Personal Style → actions).
- Decide what to **build in backend2 from scratch** vs **reuse/port from backend** (concepts only; backend2 stays separate).
- Optionally add a **one-page “Phase 4 scope”** (in this repo or in the main plan) that we can tick off as we implement.

If you want to start with one section (e.g. “Conversation API and persistence” or “Router”), we can go through it step by step and lock decisions before moving on.
