# User Profile: Sources and Gaps

## 1. Where does “style profile” come from?

In **backend2**, the combined profile exposes **style profile** as:

- **Primary:** `UserProfile.styleProfileData` — written **only** by the **Style Report Agent** (B4), which runs on **user-added images / looks**. So if the user has not done “added images” yet, this is null.
- **Fallback:** `UserProfile.profileJson` — **backend2 never writes this**. It is **legacy** data written by the **old backend** (e.g. personalization init, signup, or scripts like `initialize-all-users`, `process-personalization-events`). That pipeline builds a profile from **wishlist, cart, wardrobe, brand followers, signals** (fit, novelty, category_affinity, price_band, brand_affinity, color_bias, etc.) and stores it in `UserProfile.profileJson`.

So: **if you see style profile data (fit, category_affinity, etc.) without the user having added images, it is coming from legacy `profileJson`** (old backend personalization), not from the Style Report Agent.

---

## 2. Why is `history.summary` null?

- **Stored in:** `UserProfile.historySummary`.
- **Set by:** `setHistorySummary(userId, summary)` in `src/domain/userProfile/userProfile.js`.
- **Current state:** **Nothing in the codebase calls `setHistorySummary`.** So the field is never populated and remains null. To have a non-null history summary, you need either:
  - A job/agent that summarizes recent `UserEvent` rows and calls `setHistorySummary`, or
  - Another defined trigger that writes an aggregate summary into this field.

---

## 3. Why are fashion need and motivation null? (User Profile Agent not run)

- **Stored in:** `UserProfile.fashionNeed`, `UserProfile.fashionMotivation`.
- **Set by:** **User Profile Agent** (B3.1) via `writeNeedMotivation()`.
- **Trigger:** The agent runs **only** when **POST /api/profile/generate-need-motivation** is called (auth required). There is **no automatic trigger** (no cron, no “on login”, no “on new history”). So need/motivation stay null until that endpoint is explicitly invoked (e.g. from the app or a script).

---

## 4. Is there an “overall summary” in the user profile?

**No.** The combined user profile returned by `getUserProfile()` has **no single “overall summary” field**. It is a composite:

- `styleProfile` — style data (from Style Report or legacy profileJson)
- `history.summary` — optional aggregate summary (currently unused → null)
- `history.recentEvents` — last N raw events
- `fashionNeed`, `fashionMotivation` — from User Profile Agent (null if agent not run)
- `quiz` — quiz responses if submitted

(As of the User Profile Summary work, `getUserProfile()` also returns `summary: { overall, sections }` computed from the above.)

So the only “summary”-like field is `history.summary`, which is currently never set.

---

## 5. Personalization and user profile

**All personalization flows use `getPersonalizationContext` → `getUserProfile`.** Product listing, search, microstores, brands, and landing page choice go through `getPersonalizationContext(userId)`, which calls `getUserProfile(uid)`. Any new "for you" or recommendations endpoint should use `getPersonalizationContext` or `getUserProfile` so it receives the same profile (including `summary.overall` and `summary.sections`).

---

## 6. D.1 Implementation: Profile use in scenarios

| Scenario | Profile source | Fields used |
|----------|----------------|-------------|
| **Concierge (Styling Agent)** | `getUserProfile(userId)` | styleProfile.data (vibe, occasion, category_affinity), fashionNeed, fashionMotivation (via contextForAgents / prompt block) |
| **Find / personalized listing** | getPersonalizationContext → getUserProfile | style profile tokens, recentProductIds, followedBrandIds; preference graph when built |
| **Look planning** | getUserProfile | buildUserContextFromProfile(profile) → preferredVibe, preferredOccasion, preferredCategoryLvl1 |
| **Style report** | getUserProfile | existing style profile for context; Style Report Agent writes styleProfileData |
| **Profile/settings (F9)** | GET /api/profile | full composite profile; quiz submit writes quizResponses |

**Need/motivation trigger (D.1.2):** In addition to POST `/api/profile/generate-need-motivation` and GET `/api/profile` (throttled refresh), the backend triggers the User Profile Agent in the background when a logged-in user records a **find_visit** and their total find_visit count hits a multiple of N (e.g. every 5th visit), so active users get need/motivation generated without manual action.
