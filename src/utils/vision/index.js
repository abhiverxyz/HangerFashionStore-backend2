/**
 * Vision adapter dispatcher: routes to provider-specific adapter by provider name.
 */

import * as openaiAdapter from "./openai.js";

const adapters = {
  openai: openaiAdapter,
};

/**
 * Analyze image with the given provider and model.
 * @param {string} provider - e.g. 'openai'
 * @param {string} model - model id for the provider
 * @param {string} imageUrl - Image URL (http/https or data:)
 * @param {string} prompt - Text prompt
 * @param {{ responseFormat?: 'json_object' | 'text', maxTokens?: number }} options
 * @returns {Promise<object>}
 */
export async function analyzeWithProvider(provider, model, imageUrl, prompt, options = {}) {
  const adapter = adapters[provider?.toLowerCase()];
  if (!adapter || typeof adapter.analyze !== "function") {
    throw new Error(`Vision provider '${provider}' is not supported. Supported: ${Object.keys(adapters).join(", ")}`);
  }
  return adapter.analyze(imageUrl, prompt, { ...options, model });
}
