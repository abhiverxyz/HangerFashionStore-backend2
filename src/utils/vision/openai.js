/**
 * OpenAI vision adapter: analyze(imageUrl, prompt, options) → parsed result.
 */

import { getOpenAIClient } from "../openaiClient.js";
import { parseJsonResponse } from "../parseJsonResponse.js";

/**
 * @param {string} imageUrl - Image URL (http/https or data:)
 * @param {string} prompt - Text prompt
 * @param {{ model?: string, responseFormat?: 'json_object' | 'text', maxTokens?: number }} options
 * @returns {Promise<object>} Parsed JSON or { description: text }
 */
export async function analyze(imageUrl, prompt, options = {}) {
  const model = options.model || "gpt-4o-mini";
  const useJson = options.responseFormat !== "text";
  const maxTokens = options.maxTokens ?? 2000;

  const content = [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: imageUrl } },
  ];

  const body = {
    model,
    max_tokens: maxTokens,
    temperature: 0.3,
    messages: [{ role: "user", content }],
  };
  if (useJson) body.response_format = { type: "json_object" };

  const openai = getOpenAIClient();
  const res = await openai.chat.completions.create(body);
  const text = res.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty image analysis response");

  if (useJson) return parseJsonResponse(text);
  return { description: text };
}
