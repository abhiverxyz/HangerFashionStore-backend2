/**
 * Shared helper: strip optional markdown code fence and parse JSON from LLM/vision response text.
 */

/**
 * @param {string} text - Raw response (may be wrapped in ```json ... ```)
 * @returns {object} Parsed JSON
 */
export function parseJsonResponse(text) {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(cleaned);
}
