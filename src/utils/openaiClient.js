/**
 * Shared OpenAI client singleton. Used by LLM and vision adapters so one client and one API key check per process.
 */

import OpenAI from "openai";

let client = null;

/**
 * @returns {OpenAI}
 */
export function getOpenAIClient() {
  if (!client) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is required");
    client = new OpenAI({ apiKey: key });
  }
  return client;
}
