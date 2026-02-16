# Phase 3: User content and image generation (backend only)

## Data model definitions

- **Look** — User image of their outfit uploaded in the "looks" feature. One row = one saved look; the image is the user's photo of that outfit.
- **Wardrobe** — A single item in the user's wardrobe. It can be added explicitly (user uploads a garment photo) or extracted later from a look (e.g. parsing a look photo into individual items).
- **UserImage** — Generic user upload for broader use (reports, agents, analysis, full-body shots, etc.). Not specifically a "look" or a "wardrobe item".

## Scope (Phase 3)

- **User content**: Storage (R2 or local), CRUD for looks, wardrobe, and UserImage creation via upload.
- **Image generation**: One simple API that generates an image from a prompt (e.g. Replicate Flux), uploads the result to storage, and returns the URL. No conversational agent in Phase 3; agents that use this capability are Phase 4.
- **No frontend changes** in Phase 3.

## Implementation summary (done)

1. **Storage** — `src/utils/storage.js`: upload buffer → URL (R2 or local). Local files served at `GET /uploads/*`.
2. **Looks** — `src/domain/looks/look.js` + `src/routes/looks.js`: CRUD for Look.
   - `GET /api/looks` — list (optional `?userId=&limit=&offset=`; if auth, can omit userId to use current user).
   - `GET /api/looks/:id` — get one.
   - `POST /api/looks` — create (auth required; body: `lookData`, `imageUrl?`, `vibe?`, `occasion?`).
   - `PUT /api/looks/:id` — update (auth required).
   - `DELETE /api/looks/:id` — delete (auth required).
3. **Wardrobe** — `src/domain/wardrobe/wardrobe.js` + `src/routes/wardrobe.js`: CRUD + upload.
   - `GET /api/wardrobe` — list current user (auth required; `?limit=&offset=&category=`).
   - `GET /api/wardrobe/:id` — get one (auth, ownership check).
   - `POST /api/wardrobe/upload` — multipart `file` + optional `brand`, `category`, `color`, `size`, `tags` (auth required).
   - `POST /api/wardrobe` — create with `imageUrl` in body (auth required).
   - `PUT /api/wardrobe/:id`, `DELETE /api/wardrobe/:id` — update/delete (auth, ownership).
4. **UserImage** — `src/domain/userImage/userImage.js` + `src/routes/userImages.js`.
   - `GET /api/user-images` — list current user's images (auth required).
   - `POST /api/user-images/upload` — multipart `file` + optional `context` (auth required).
5. **Generate** — `src/domain/images/generate.js` + `src/routes/generate.js`.
   - `POST /api/generate/image` — body: `{ prompt, aspectRatio? }`; returns `{ imageUrl, key }` (auth required; uses Replicate Flux, then stores in R2/local).
6. **Agents** — All agents (conversation, look builder, etc.) live in Phase 4, in a dedicated layer (e.g. `src/services/agents/` or `src/agents/`). Phase 3 only provides the generate API used by them later.
