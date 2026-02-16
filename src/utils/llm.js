/**
 * LLM utility: chat/complete and embed. Uses central model config; supports per-call provider/model overrides.
 * Phase A: OpenAI only; adapters for other providers can be added later.
 */

import { getModelConfig } from "../config/modelConfig.js";
import { getOpenAIClient } from "./openaiClient.js";
import { parseJsonResponse } from "./parseJsonResponse.js";

/**
 * Single chat completion; returns parsed JSON if response_format is json_object.
 * Supports vision: messages can include content blocks with type "image_url" (OpenAI format).
 * Provider/model from getModelConfig('llm') plus optional options.provider, options.model.
 */
export async function chat({
  messages,
  responseFormat = null,
  temperature = 0.3,
  maxTokens = 2000,
  provider: providerOverride,
  model: modelOverride,
} = {}) {
  const config = await getModelConfig("llm", { provider: providerOverride, model: modelOverride });
  if (!config) throw new Error("No model config for scope llm");
  if (config.provider !== "openai") {
    throw new Error(`LLM provider '${config.provider}' is not supported yet. Use openai.`);
  }

  const openai = getOpenAIClient();
  const body = {
    model: config.model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (responseFormat === "json_object") body.response_format = { type: "json_object" };
  const res = await openai.chat.completions.create(body);
  const content = res.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Empty LLM response");
  if (responseFormat === "json_object") return parseJsonResponse(content);
  return content;
}

/**
 * Alias for chat — single completion entry for agents. Use for text and/or vision (image_url in messages).
 * @param {Array} messages - OpenAI-format messages; content can be string or array of { type, text } | { type: "image_url", image_url: { url } }
 * @param {object} options - { responseFormat?, temperature?, maxTokens?, provider?, model? }
 */
export async function complete(messages, options = {}) {
  return chat({
    messages,
    responseFormat: options.responseFormat ?? null,
    temperature: options.temperature ?? 0.3,
    maxTokens: options.maxTokens ?? 2000,
    provider: options.provider,
    model: options.model,
  });
}

/**
 * Text embedding (for product search, semantic similarity). Returns array of numbers.
 * Provider/model from getModelConfig('embed') plus optional options.provider, options.model.
 */
export async function embed(text, options = {}) {
  const config = await getModelConfig("embed", { provider: options.provider, model: options.model });
  if (!config) throw new Error("No model config for scope embed");
  if (config.provider !== "openai") {
    throw new Error(`Embed provider '${config.provider}' is not supported yet. Use openai.`);
  }

  const openai = getOpenAIClient();
  const res = await openai.embeddings.create({
    model: config.model,
    input: typeof text === "string" ? text : text.slice(0, 8000),
  });
  const vec = res.data?.[0]?.embedding;
  if (!vec) throw new Error("Empty embedding response");
  return vec;
}

/** Alias for embed — agents use embedText(text) for clarity. */
export async function embedText(text, options = {}) {
  return embed(text, options);
}
