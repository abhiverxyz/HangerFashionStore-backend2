# Storage audit: images and videos (backend2 & frontend2)

All image and video storage in backend2 goes through **one place**: `src/utils/storage.js` → `uploadFile(buffer, key, contentType, options)`. When `R2_ENABLED=true` and credentials are set, `uploadFile` writes to **R2 only** (no local write). When R2 is off, it writes to local `public/uploads/` only.

## Backend2 – every path that writes media

| # | Source | Entry point | Uses `uploadFile`? | Notes |
|---|--------|-------------|---------------------|--------|
| 1 | **Admin** | `POST /api/admin/storage-test/upload` | Yes | Test upload; `requireRemote: false` |
| 2 | **Feed (admin/user)** | `POST /api/feed-posts/upload` | Yes | Image or video; `requireRemote: false` |
| 3 | **Wardrobe (user)** | `POST /api/wardrobe/upload` | Yes | User wardrobe item image; `requireRemote: true` |
| 4 | **User images (user)** | `POST /api/user-images/upload` | Yes | Chat attachments etc.; `requireRemote: true` |
| 5 | **Look analysis (user)** | `POST /api/looks/analyze` (multipart file) | Yes | Via `lookAnalysisAgent`: uploads buffer then analyzes; `requireRemote: false` |
| 6 | **Generated images (system)** | `domain/images/generate.js` → `generateAndStoreImage()` | Yes | Flux/Replicate output → `uploadFile`; `requireRemote: true` |
| 7 | **Generate API (user/auth)** | `POST /api/generate/image` | Yes | Calls `generateAndStoreImage()` → same as #6 |

**Where generated images are used**

- **Look Composition** (`domain/lookComposition/lookComposition.js`): when `generateImage: true`, calls `generateImage()` → `generateAndStoreImage()` → `uploadFile`. Stored in R2 when enabled.
- **MicroStore Curation** (`agents/microstoreCurationAgent.js`): store hero image via `generateImage()` → same path → R2.
- **Look Planning** (`agents/lookPlanningAgent.js`): per-look image via `composeLook({ generateImage: true })` → Look Composition → R2.

**No other file writes**

- The only `writeFile` in `backend2/src` is inside `storage.js` for the **local fallback** when R2 is disabled. No route or agent writes images/videos to disk except through `uploadFile`.

## Frontend2

- The frontend does **not** write files to disk or to R2 directly. All media are stored by calling backend APIs that use `uploadFile`:
  - User images: `POST /api/user-images/upload`
  - Feed: `POST /api/feed-posts/upload`
  - Wardrobe: `POST /api/wardrobe/upload`
  - Look analyze: `POST /api/looks/analyze` (with file)
  - Generate image: `POST /api/generate/image`
- Admin storage test uses `POST /api/admin/storage-test/upload`.

## Conclusion

**When R2 is enabled and configured, all images and videos (user uploads, admin/brand uploads, and system-generated) are stored in R2 only.** There is no dual-write and no alternate path that writes media to local disk when R2 is on.

---

# Image load, safety & speed audit

## 1. Do images load correctly?

- **Access path:** All display of our-storage images goes through `GET /api/storage/access?url=...&access_token=...` (or without token for public keys). Backend resolves key, checks permissions, then 302 to presigned URL (R2) or `/uploads/key` (local). Browsers follow redirects for `<img src>`, so the image loads.
- **Frontend usage:** Every place that shows our-storage images uses `getImageDisplayUrl(imageUrl, accessToken)` with `useStorageAccessToken()`:
  - `ConciergeAvatarCircle` (avatar images)
  - `FlowContextCards` (look images)
  - `ConciergeProductCard` (product images)
  - Concierge page (message attachments)
  - Admin styling-agent (avatar list)
  - Admin styling-test (look/product images)
- **No-token behaviour:** For **private** our-storage URLs, `getImageDisplayUrl` returns `""` when there is no `accessToken`, so the component shows its placeholder (e.g. initial/cartoon for avatars) instead of a request that would 401. For **public** keys (`admin-test/*`), the access URL is returned without a token so they load without auth.
- **External URLs:** Shopify or other external image URLs are not rewritten; they are used as-is, so they continue to load from their CDN.

**Verdict:** Images load correctly when the user is authenticated (and token is available) for private content; public and external URLs load as before.

## 2. Are images safe and private?

- **Backend access route** (`backend2/src/routes/storageAccess.js`):
  - **Public:** `admin-test/*` — no auth.
  - **Auth required, any user:** `styling-avatars/*`, `generated/*`.
  - **Auth + ownership:** `user-images/{userId}/*`, `wardrobe/{userId}/*`, `feed-posts/{userId}/*`, `looks/{userId}/*`; `looks/anon/*` allowed for any authenticated user.
  - Unauthenticated requests for non-public keys get **401**; wrong user gets **403**.
- **Token:** Short-lived storage JWT (e.g. 5 min), purpose `"storage"`, contains `userId`. Used only in query for `<img>` (no Cookie sent cross-origin). Backend validates token and sets `userId` for permission checks.
- **No direct R2 URLs in frontend:** Stored R2 URLs are never exposed to the client; the client only sees the access endpoint. The browser is redirected to a time-limited presigned URL, so links are not long-term shareable.

**Verdict:** Private images are safe and scoped by auth and ownership; public keys are explicitly limited to `admin-test/*`.

## 3. Is load fast?

- **Single redirect:** One round-trip to our API (with token), then 302 to presigned or local URL. No extra proxy streaming; the browser fetches the image directly from R2 or local server.
- **Token reuse:** One storage access token is fetched per logged-in session and reused for all private image requests; refetched every 4 minutes. No per-image token call.
- **Placeholder until token:** For private our-storage, we don’t set `src` until we have a token (we return `""` and show placeholder), avoiding a 401 then retry. Once the token is available (shortly after login), all subsequent images use it.
- **R2/CDN:** Presigned URLs point at R2 (or your custom domain), so image bytes come from R2’s edge, not from your API server.

**Verdict:** Load is fast: one access call per image (redirect), shared token, no per-image auth calls, and image bytes from R2/local.

---

**Optional follow-ups:** If `generated/*` should be restricted by ownership (e.g. by `GeneratedImage.userId`), the access route would need to resolve key → resource and check ownership (e.g. DB lookup). Documenting key patterns and the access flow in a short “Storage & images” doc is recommended for maintainers.
