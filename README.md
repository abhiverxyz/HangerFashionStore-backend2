# Backend 2

Node.js API for Hanger Fashion Store: auth, products, looks, wardrobe, conversations, agents (styling, search, look planning, match, feed, etc.), and admin. Uses PostgreSQL (Prisma), Redis for job queues, and optional R2 for image storage.

**Node:** >= 20 (see `engines` in package.json).

## Run

```bash
# Development (with .env)
npm run dev

# Production
npm start

# Background worker (enrichment + Shopify sync). Requires Redis.
npm run worker
```

Default port: 3002. Set `PORT` in env to override.

## Environment

Create a `.env` file (see `.env.example` if present). Main variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection URL (Prisma). |
| `JWT_SECRET` | Yes in prod | Secret for signing JWTs. |
| `OPENAI_API_KEY` | Yes for LLM/vision | OpenAI API key (LLM, embeddings, image analysis). |
| `REDIS_URL` | Yes for queues | Redis URL (default `redis://localhost:6379`). Required for product enrichment and Shopify sync; worker consumes jobs from Redis. |
| `R2_ENABLED` | No | Set `true` to store uploads in Cloudflare R2. If false, files go to `public/uploads/`. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | If R2 | Cloudflare R2 credentials and bucket. |
| `REPLICATE_API_TOKEN` | For image gen | Replicate API token (Flux image generation). |
| `CORS_ORIGIN` | No | Allowed origin(s) for CORS (default dev: any origin). |
| `ADMIN_SECRET` | No | Optional; used by CLI script `import-from-public-url.js` for admin auth without JWT. |
| `CRON_SECRET` | No | Optional; for cron-triggered Fashion Content Agent. |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start API with `.env`. |
| `npm run start` | Start API (no env file; use system env). |
| `npm run worker` | Run enrichment + sync worker (needs Redis). |
| `npm run prisma:generate` | Generate Prisma client. |
| `npm run test:b0` | Test B0 utilities (vision, LLM, embeddings, storage; skips image gen). |
| `npm run test:b0:all` | Same plus image generation (uses Replicate). |

One-off scripts (run with `node --env-file=.env scripts/<name>.js`):

- **scripts/seed-styling-avatars.js** — Seed styling avatars and default goals. Run once after migrations.
- **scripts/import-from-public-url.js** — Import products from a store’s public `products.json`. Usage: `node scripts/import-from-public-url.js <store-url> [brand-name]`. Uses `ADMIN_SECRET` or `ADMIN_TOKEN` for auth.
- **scripts/run-style-report-smoke-test.js** — Smoke test Style Report Agent. Usage: `USER_ID=xxx node scripts/run-style-report-smoke-test.js` or pass userId as first arg.

## Operational notes

- **Single instance:** The API is a single Node process. Horizontal scaling would require running multiple instances behind a load balancer; the app is stateless and shares DB and Redis.
- **Redis:** Enrichment and Shopify sync depend on Redis. If Redis is down, enqueue operations will fail; sync-status returns zeroed queue stats on Redis errors. Run at least one worker process to consume jobs.
- **DB pool:** Default pool size is 20 (see `src/core/db.js`). Sufficient for one API instance.
- **Storage:** With `R2_ENABLED=true`, all image/video uploads and generated images go to R2. Otherwise they are written to `public/uploads/` on disk.

## Documentation

- **docs/ARCHITECTURE_AGENTS_AND_SERVICES.md** — Agents and services overview.
- **docs/AGENT_AGENTIC_AUDIT_B0_B9.md** — Agent audit (generate/validate/tools).
- **docs/IMPLEMENTATION_PLAN_PHASES.md** — Phase plan and architecture.
- **docs/STORAGE_AUDIT_IMAGES_VIDEOS.md** — Where images/videos are stored (R2/local).
- **src/utils/README.md** — B0 utilities (LLM, vision, storage, image gen).

## Security

- Run `npm audit` and fix high/critical issues. (Moderate issues may remain in dev tooling such as Prisma; address when upgrading.)
- In production, 500 responses use a generic message; the global error handler in `src/index.js` does not send `err.message` or stack traces to clients.
