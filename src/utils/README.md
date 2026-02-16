# Utilities (B0)

Shared capabilities used by agents and services. No business logic; implement once, reuse everywhere.

**Config:** Provider and model per utility are resolved by `src/config/modelConfig.js` (env → DB with cache). Admin can override via **Admin → AI / Model settings**.

| Utility | Module | Usage |
|---------|--------|--------|
| **Image analysis (Vision)** | `imageAnalysis.js` | `analyzeImage(imageUrlOrBuffer, options?)` → structured result. Uses `vision/` adapters (OpenAI). |
| **Image generation** | `imageGeneration.js` | `generateImage(prompt, options?)` → `{ imageUrl }`. Wraps domain/images/generate (Replicate Flux). |
| **LLM** | `llm.js` | `chat({ messages, ... })`, `complete(messages, options?)` — supports text and vision (image_url in messages). |
| **Storage** | `storage.js` | `uploadFile(buffer, key, contentType)` → `{ url, key, hash, size }` |
| **Embeddings** | `llm.js` | `embed(text)`, `embedText(text)` → vector (for semantic search; embedImage deferred to B3 if needed) |

**Shared:** `openaiClient.js` (single OpenAI client for LLM + vision), `parseJsonResponse.js` (LLM/vision JSON parsing).

## Testing B0

From repo root (backend2):

```bash
# Test all B0 utilities (image analysis, LLM, embeddings, storage). Skips image generation.
npm run test:b0

# Include image generation (uses Replicate credits)
npm run test:b0:all
```

Requires `.env` with at least `OPENAI_API_KEY` for vision/LLM/embeddings; `REPLICATE_API_TOKEN` and storage (R2 or local) for full tests. Storage test uploads a small file to `b0-test/<timestamp>.txt`.
