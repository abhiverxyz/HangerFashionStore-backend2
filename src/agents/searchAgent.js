/**
 * B3.3 Search Agent
 * Query (text or image) → product search → results + optional NL summary; validate relevance.
 * Refinement = another turn (user sends follow-up message, we search again with new query/image).
 */

import { complete } from "../utils/llm.js";
import { searchProducts } from "../domain/product/product.js";

const SEARCH_LIMIT = 12;
const SUMMARY_MAX_TOKENS = 150;
const VALIDATE_MAX_TOKENS = 120;
const VALIDATE_RELEVANCE_MAX_TOKENS = 180;
const RELEVANCE_ITEMS_CAP = 8;
const SUGGESTED_REPLY_MAX_LENGTH = 300;

/**
 * Map search result item to card product shape (same as Styling Agent: id, title, brandName, imageUrl, handle).
 */
function toCardProduct(p) {
  return {
    id: p.id,
    title: p.title,
    brandName: p.brand?.name ?? null,
    imageUrl: p.images?.[0]?.src ?? null,
    handle: p.handle,
  };
}

/**
 * Optional: generate a short NL summary of search results using LLM.
 */
async function generateSearchSummary(queryOrImage, items, total) {
  try {
    const itemTitles = (items || []).slice(0, 6).map((p) => p.title).filter(Boolean);
    const prompt = `User searched for: "${queryOrImage}". We found ${total} result(s). Sample titles: ${itemTitles.join("; ") || "none"}. Write one short, friendly sentence summarizing what we found (e.g. "Here are some options that match your search." or "I found several items you might like."). No preamble.`;
    const reply = await complete(
      [{ role: "user", content: prompt }],
      { maxTokens: SUMMARY_MAX_TOKENS, temperature: 0.3 }
    );
    return typeof reply === "string" ? reply.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Optional: validate relevance (if no results, suggest broadening).
 */
function validateRelevance(total, items, reply) {
  if (total > 0) return reply;
  return "I couldn't find anything that matches. Try a different search term, or broaden your query (e.g. \"dresses\" instead of a specific style).";
}

/**
 * Validate whether search results match the user's query well. When they don't, returns a suggested reply to set expectations.
 * @param {string} queryOrImageLabel - User query or "this image"
 * @param {Object[]} items - Product items (title, category_lvl1)
 * @param {string} currentReply - Current summary reply
 * @returns {Promise<{ ok: boolean, suggestedReply?: string | null } | null>}
 */
async function validateSearchRelevance(queryOrImageLabel, items, currentReply) {
  try {
    const list = (items || []).slice(0, RELEVANCE_ITEMS_CAP).map((p) => ({
      title: (p.title || "").slice(0, 80),
      category: (p.category_lvl1 || "").slice(0, 40),
    }));
    const prompt = `You are a search quality checker.

User searched for: "${String(queryOrImageLabel).slice(0, 150)}"
Current reply to user: "${String(currentReply || "").slice(0, 200)}"

Top results (title, category): ${JSON.stringify(list)}

Do these results match the user's search intent well? If they are only loosely related or a stretch, say no and suggest a better reply that sets expectations (e.g. "Here are the closest matches we have; try X for more options." or "These are related items; you might also search for Y.").

Reply with JSON only: { "ok": boolean, "suggestedReply": string | null }. If ok is false, suggestedReply must be one short, helpful sentence. If ok is true, suggestedReply can be null.`;

    const out = await complete(
      [
        { role: "system", content: "You output only valid JSON. No markdown or preamble." },
        { role: "user", content: prompt },
      ],
      { responseFormat: "json_object", maxTokens: VALIDATE_RELEVANCE_MAX_TOKENS }
    );
    if (out && typeof out === "object") {
      return {
        ok: Boolean(out.ok),
        suggestedReply: typeof out.suggestedReply === "string" ? out.suggestedReply.trim() : null,
      };
    }
  } catch (e) {
    console.warn("[searchAgent] validateSearchRelevance failed:", e?.message);
  }
  return null;
}

/**
 * Run the Search Agent: search products by query and/or image, build reply + product cards.
 * @param {{ message: string, imageUrls?: string[], history?: Object[] }} input
 * @param {{ userId?: string }} context
 * @returns {Promise<{ reply: string, flowType: string, flowContext: object | null }>}
 */
export async function run(input, context) {
  const { message, imageUrls } = input;
  const imageUrlList = Array.isArray(imageUrls) ? imageUrls.filter((u) => u != null && String(u).trim() !== "").map(String) : [];
  const query = (message || "").trim();
  const imageUrl = imageUrlList.length > 0 ? imageUrlList[0] : null;

  if (!query && !imageUrl) {
    return {
      reply: "What would you like to search for? You can describe an item or share an image to find similar products.",
      flowType: "none",
      flowContext: null,
    };
  }

  try {
    const { items, total } = await searchProducts({
      query: query || undefined,
      imageUrl: imageUrl || undefined,
      limit: SEARCH_LIMIT,
      offset: 0,
      status: "active",
    });

    const cardProducts = (items || []).map(toCardProduct);
    const hasCards = cardProducts.length > 0;

    let reply = await generateSearchSummary(query || "this image", items || [], total);
    if (!reply) {
      if (hasCards) reply = "Here are some products that match your search.";
      else reply = "I couldn't find any products matching that.";
    }
    if (total > 0 && items && items.length > 0) {
      const relevance = await validateSearchRelevance(query || "this image", items, reply);
      if (relevance && !relevance.ok && relevance.suggestedReply) {
        reply = relevance.suggestedReply.slice(0, SUGGESTED_REPLY_MAX_LENGTH);
      }
    }
    reply = validateRelevance(total, items, reply);

    // Use same flowContext shape as Styling Agent so existing chat UI can show product cards
    const flowContext = hasCards
      ? { looks: [], products: cardProducts, tips: [], makeupHair: [], total }
      : null;

    return {
      reply,
      flowType: hasCards ? "styling_cards" : "none",
      flowContext,
    };
  } catch (err) {
    console.warn("[searchAgent] search failed:", err?.message);
    return {
      reply: "Search failed. Please try again or rephrase your query.",
      flowType: "none",
      flowContext: null,
    };
  }
}
