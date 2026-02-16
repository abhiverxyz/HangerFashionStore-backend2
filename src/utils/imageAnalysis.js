/**
 * Image analysis (Vision) utility — B0.1
 * Single interface for agents: analyzeImage(imageUrlOrBuffer, options?) → structured result.
 * Uses central model config and vision adapters (OpenAI by default). Used by Look Analysis, Style Report, Wardrobe Extraction agents.
 */

import { getModelConfig } from "../config/modelConfig.js";
import { analyzeWithProvider } from "./vision/index.js";

/**
 * Normalize image input to a URL string for the API.
 * @param {string|Buffer} imageUrlOrBuffer - Public image URL or buffer
 * @returns {string} URL (http/https or data:)
 */
function toImageUrl(imageUrlOrBuffer) {
  if (Buffer.isBuffer(imageUrlOrBuffer)) {
    const base64 = imageUrlOrBuffer.toString("base64");
    return `data:image/png;base64,${base64}`;
  }
  if (typeof imageUrlOrBuffer === "string" && imageUrlOrBuffer.trim()) {
    return imageUrlOrBuffer.trim();
  }
  throw new Error("imageUrlOrBuffer must be a URL string or Buffer");
}

const DEFAULT_PROMPT = `Analyze this fashion/outfit image. Return a single JSON object with exactly two keys: "items" and "look".

"items": array of objects, one per visible item (clothing, footwear, accessories). For each item include (use null when not detectable):
- type: "clothing" | "footwear" | "accessory"
- description: string (full description for style reports)
- category_lvl1, category_lvl2, category_lvl3: string (e.g. Tops, Shirts, Blouse)
- color_primary, color_family: string
- fabric_primary, pattern, fit, length, coverage: string
- style_family, occasion_primary, occasion_secondary, mood_vibe: string
- trend_tags: array of strings (e.g. ["minimalist", "oversized"])
- sleeve_length, sleeve_style: string (where relevant)
- gender: string or null

"look": one object for the overall look:
- description: string (overall look description)
- vibe: string (e.g. casual, formal, streetwear)
- occasion: string (e.g. work, party, vacation)
- timeOfDay: string or null (e.g. day, evening)
- labels: array of strings (e.g. "minimalist", "bold")
- trend_tags: array of strings (overall look trends)
- hair: string (hair style/description)
- makeup: string (makeup style/description)
- comment: one short sentence — validation, encouragement, or suggestion`;

const DEFAULT_MAX_TOKENS = 2000;

/**
 * Analyze an image and return structured data: items (catalog-aligned) and look (overall + hair/makeup/trends).
 * Use options.prompt to supply a custom prompt; then the response shape is caller-defined.
 * @param {string|Buffer} imageUrlOrBuffer - Image URL or buffer
 * @param {object} options - { prompt?, responseFormat?: "json_object", provider?, model?, maxTokens? }
 * @returns {Promise<object>} { items: [...], look: { description, vibe, occasion, trend_tags, hair, makeup, ... } } or custom if prompt overridden
 */
export async function analyzeImage(imageUrlOrBuffer, options = {}) {
  const url = toImageUrl(imageUrlOrBuffer);
  const prompt = options.prompt ?? DEFAULT_PROMPT;
  const config = await getModelConfig("imageAnalysis", {
    provider: options.provider,
    model: options.model,
  });
  if (!config) throw new Error("No model config for scope imageAnalysis");
  return analyzeWithProvider(config.provider, config.model, url, prompt, {
    responseFormat: options.responseFormat,
    maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
  });
}
