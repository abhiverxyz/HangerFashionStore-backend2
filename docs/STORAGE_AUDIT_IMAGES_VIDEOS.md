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
