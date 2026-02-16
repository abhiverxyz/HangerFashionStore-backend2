/**
 * Central model config: resolves provider and model per scope.
 * Resolution order: per-call options → config store (DB) → env defaults.
 */

import { loadFromDb } from "./modelConfigDb.js";

/** Known scopes for utilities and (future) agents. */
export const KNOWN_SCOPES = ["imageAnalysis", "llm", "embed", "imageGeneration"];

const ENV_MAP = {
  imageAnalysis: {
    provider: "IMAGE_ANALYSIS_PROVIDER",
    model: "IMAGE_ANALYSIS_MODEL",
    defaultProvider: "openai",
    defaultModel: "gpt-4o-mini",
  },
  llm: {
    provider: "LLM_PROVIDER",
    model: "LLM_MODEL",
    defaultProvider: "openai",
    defaultModel: "gpt-4o-mini",
  },
  embed: {
    provider: "EMBED_PROVIDER",
    model: "EMBED_MODEL",
    defaultProvider: "openai",
    defaultModel: "text-embedding-3-small",
  },
  imageGeneration: {
    provider: "IMAGE_GENERATION_PROVIDER",
    model: "IMAGE_GENERATION_MODEL",
    defaultProvider: "flux",
    defaultModel: "black-forest-labs/flux-schnell",
    // Legacy: IMAGE_PROVIDER used by domain/images/generate.js before config layer
    envProviderFallback: "IMAGE_PROVIDER",
  },
};

// In-memory cache for DB-backed config (Phase B). Key: scope, value: { provider, model }. Null = not loaded.
let cache = Object.create(null);
let cacheExpiry = Object.create(null);
const CACHE_TTL_MS = 60_000;

function getEnvConfig(scope) {
  const def = ENV_MAP[scope];
  if (!def) return null;
  const providerRaw =
    process.env[def.provider] || (def.envProviderFallback && process.env[def.envProviderFallback]) || def.defaultProvider;
  const provider = providerRaw.toLowerCase();
  const model = process.env[def.model] || def.defaultModel;
  return { provider, model };
}

/**
 * Get model config for a scope. Merges optional overrides (e.g. from per-call options).
 * @param {string} scope - e.g. 'imageAnalysis', 'llm', 'embed', 'imageGeneration'
 * @param {{ provider?: string, model?: string }} overrides - optional per-call overrides
 * @returns {Promise<{ provider: string, model: string }>}
 */
export async function getModelConfig(scope, overrides = {}) {
  let base = null;

  try {
    const cached = cache[scope];
    const expiry = cacheExpiry[scope];
    if (cached != null && expiry != null && Date.now() < expiry) {
      base = cached;
    } else {
      base = await loadFromDb(scope);
      if (base) {
        cache[scope] = base;
        cacheExpiry[scope] = Date.now() + CACHE_TTL_MS;
      }
    }
  } catch (_) {
    // DB unavailable (e.g. DATABASE_URL not set); fall back to env
  }

  if (!base) base = getEnvConfig(scope);
  if (!base) return base;

  const provider = overrides.provider != null ? String(overrides.provider).toLowerCase() : base.provider;
  const model = overrides.model != null ? String(overrides.model).trim() : base.model;
  return { provider, model };
}

/**
 * Invalidate cache for a scope (call after DB update). Used by admin PUT.
 * @param {string} [scope] - if omitted, invalidate all
 */
export function invalidateModelConfigCache(scope) {
  if (scope != null) {
    delete cache[scope];
    delete cacheExpiry[scope];
  } else {
    cache = Object.create(null);
    cacheExpiry = Object.create(null);
  }
}

/**
 * Get config for all known scopes (for admin GET). Returns current effective config (DB or env).
 * Fetches scopes in parallel for speed when cache is cold.
 * @returns {Promise<Record<string, { provider: string, model: string }>>}
 */
export async function getAllModelConfig() {
  const entries = await Promise.all(
    KNOWN_SCOPES.map(async (scope) => {
      const config = await getModelConfig(scope);
      return [scope, config];
    })
  );
  return Object.fromEntries(entries.filter(([, c]) => c != null));
}
