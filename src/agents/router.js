/**
 * B2.2 / B3.5 / B4.7 / B5.5 / B7.5 Router
 * Given message + conversation history + optional image, classifies intent and routes to:
 * - B7.5: match_wishlist (wishlist match to you)
 * - B5.5: look_planning (plan looks for vacation, outfits for a trip)
 * - B4: look_analyze (diary), style_report, wardrobe extraction
 * - B3: search
 * - B2: styling (default)
 */

import { run as runStylingAgent } from "./stylingAgent.js";
import { run as runSearchAgent } from "./searchAgent.js";

/** Phrases that strongly indicate search intent (find items, not styling advice). */
const SEARCH_PATTERNS = [
  /\b(find|search|look for|looking for)\b/i,
  /\bshow me\s+(.+?(?:dress|shirt|shoes|bag|jacket|jeans|top|bottom|outfit|items?|products?))\b/i,
  /\b(anything|something)\s+(like this|similar)\b/i,
  /\bsimilar to (this|that)\b/i,
  /\b(like this|like that)\s*[.?!]?\s*$/i,
  /\bget me\s+.+/i,
  /\bwhere can I (find|get|buy)\b/i,
  /\b(any|some)\s+(good\s+)?(options?|choices?|alternatives?)\b/i,
];

/** B4.7: Message patterns for style report (no image required). */
const STYLE_REPORT_PATTERNS = [
  /\bstyle\s+report\b/i,
  /\b(generate|create|show|get|give me)\s+(my\s+)?(style\s+)?report\b/i,
  /\bmy\s+style\s+report\b/i,
  /\b(style\s+report)\s+(for\s+me|please)\b/i,
];

/** B4.7: Message patterns for look analyze / diary (image expected). */
const LOOK_ANALYZE_PATTERNS = [
  /\b(add|save)\s+(this\s+)?(to\s+my\s+)?(diary|looks?)\b/i,
  /\b(analyze|analyse)\s+this\s+look\b/i,
  /\badd\s+to\s+diary\b/i,
  /\b(save|record)\s+this\s+outfit\b/i,
  /\bmy\s+(fashion\s+)?diary\b/i,
];

/** B4.7: Message patterns for wardrobe extraction (image expected). */
const WARDROBE_PATTERNS = [
  /\b(add|save)\s+(this\s+)?(to\s+my\s+)?wardrobe\b/i,
  /\b(extract|get)\s+(items?|pieces)\s+from\s+(this\s+)?(look|outfit)\b/i,
  /\bwhat'?s\s+in\s+this\s+(outfit|look)\b/i,
  /\badd\s+to\s+wardrobe\b/i,
  /\bwardrobe\s+from\s+this\b/i,
];

/** B7.5: Message patterns for wishlist/match intent (match my wishlist to me, which suit my style). */
const MATCH_WISHLIST_PATTERNS = [
  /\bmatch\s+(my\s+)?(wishlist|saved\s+items?)\s+(to\s+me|for\s+me)?\b/i,
  /\b(which|what)\s+(items?|pieces?|things?)\s+(suit|match|fit)\s+(my\s+)?(style|me)\b/i,
  /\banalyze\s+(my\s+)?(wishlist|saved\s+items?)\b/i,
  /\bhow\s+(do\s+)?(my\s+)?(wishlist|saved\s+items?)\s+match\s+(me|my\s+style)\b/i,
  /\b(wishlist|saved\s+items?)\s+(match|analysis|for\s+me)\b/i,
  /\b(match|suit)\s+my\s+style\b/i,
];

/** B5.5: Message patterns for look planning / occasion (plan looks for vacation, outfits for a trip). */
const LOOK_PLANNING_PATTERNS = [
  /\bplan\s+looks?\s+(?:for\s+)?/i,
  /\boutfits?\s+for\s+(?:a\s+)?(?:weekend\s+)?(?:trip|vacation|holiday|travel)\b/i,
  /\blooks?\s+for\s+(?:my\s+)?(?:vacation|trip|weekend|travel|holiday)\b/i,
  /\b(?:need|want)\s+(?:some\s+)?(?:outfits?|looks?)\s+for\s+/i,
  /\b(?:pack|packing)\s+for\s+(?:a\s+)?(?:trip|vacation)\b/i,
  /\b(?:what\s+to\s+wear|outfit\s+ideas?)\s+for\s+/i,
  /\b(?:vacation|trip|weekend)\s+outfits?\b/i,
  /\b(?:diverse|multiple)\s+looks?\s+for\s+/i,
];

/**
 * Classify turn intent: B7.5 (match_wishlist), B5.5 (look_planning), B4 (look_analyze, style_report, wardrobe), search, or styling.
 * @param {{ message: string, imageUrls?: string[] }} input
 * @returns {"match_wishlist" | "look_planning" | "look_analyze" | "style_report" | "wardrobe" | "search" | "styling"}
 */
export function classifyIntent(input) {
  const { message, imageUrls } = input;
  const text = (message || "").trim();
  const hasImage = Array.isArray(imageUrls) ? imageUrls.length > 0 : false;

  // B7.5: Match wishlist (message-only)
  for (const re of MATCH_WISHLIST_PATTERNS) {
    if (re.test(text)) return "match_wishlist";
  }

  // B5.5: Look planning / occasion (message-only)
  for (const re of LOOK_PLANNING_PATTERNS) {
    if (re.test(text)) return "look_planning";
  }

  // B4.7: Style report (message-only)
  for (const re of STYLE_REPORT_PATTERNS) {
    if (re.test(text)) return "style_report";
  }

  // B4.7: Look analyze / diary (image + message)
  if (hasImage) {
    for (const re of LOOK_ANALYZE_PATTERNS) {
      if (re.test(text)) return "look_analyze";
    }
    for (const re of WARDROBE_PATTERNS) {
      if (re.test(text)) return "wardrobe";
    }
  }

  // B3: Search
  for (const re of SEARCH_PATTERNS) {
    if (re.test(text)) return "search";
  }

  // Image with very short or no text often means "find similar"
  if (hasImage && text.length <= 30) {
    const lower = text.toLowerCase();
    if (!text || /^(this|like this|similar|find (something )?like this|anything like this)[.?!]?\s*$/i.test(text)) {
      return "search";
    }
    if (/^(what (about|do you think)|how (do i look|does this look)|feedback)/i.test(lower)) {
      return "styling";
    }
  }

  return "styling";
}

/**
 * B4.7: Run Look Analysis Agent and return conversation-shaped result.
 */
async function runLookAnalyzeForConversation(input, context) {
  const { imageUrls } = input;
  const userId = context?.userId;
  const imageUrl = Array.isArray(imageUrls) && imageUrls.length > 0 ? imageUrls[0] : null;

  if (!userId || !imageUrl) {
    return {
      reply: "Please share an image of your look to add it to your diary. You can say something like “Add this to my diary” and attach the photo.",
      flowType: "none",
      flowContext: null,
    };
  }

  try {
    const { run: runLookAnalysisAgent } = await import("./lookAnalysisAgent.js");
    const result = await runLookAnalysisAgent({
      userId,
      imageUrl,
    });
    const reply = result.analysisComment || result.comment || "I've added this look to your diary.";
    return {
      reply,
      flowType: "look_analyze",
      flowContext: {
        lookId: result.lookId,
        comment: result.comment,
        vibe: result.vibe,
        occasion: result.occasion,
        analysisComment: result.analysisComment,
        suggestions: result.suggestions,
        look: result.look,
      },
    };
  } catch (err) {
    console.warn("[router] look_analyze failed:", err?.message);
    return {
      reply: "I couldn't analyze that look right now. Please try again or add the look from the diary page.",
      flowType: "none",
      flowContext: null,
    };
  }
}

/**
 * B4.7: Run Style Report Agent and return conversation-shaped result.
 */
async function runStyleReportForConversation(input, context) {
  const userId = context?.userId;
  if (!userId) {
    return {
      reply: "Please sign in to generate your style report.",
      flowType: "none",
      flowContext: null,
    };
  }

  try {
    const { run: runStyleReportAgent } = await import("./styleReportAgent.js");
    const result = await runStyleReportAgent({ userId, forceRegenerate: true });
    if (result.notEnoughLooks) {
      return {
        reply: result.message || "Add more looks to your diary first, then I can generate your style report.",
        flowType: "none",
        flowContext: null,
      };
    }
    return {
      reply: "I've generated your style report. You can view it in your style report section.",
      flowType: "style_report",
      flowContext: {
        reportData: result.reportData,
        styleProfileUpdated: result.styleProfileUpdated,
      },
    };
  } catch (err) {
    console.warn("[router] style_report failed:", err?.message);
    return {
      reply: "I couldn't generate your style report right now. Please try again later.",
      flowType: "none",
      flowContext: null,
    };
  }
}

/**
 * B4.7: Run Wardrobe Extraction Agent and return conversation-shaped result.
 */
async function runWardrobeExtractionForConversation(input, context) {
  const { imageUrls } = input;
  const userId = context?.userId;
  const imageUrl = Array.isArray(imageUrls) && imageUrls.length > 0 ? imageUrls[0] : null;

  if (!userId || !imageUrl) {
    return {
      reply: "Share a photo of your look and ask to add it to your wardrobe (e.g. “Add this to my wardrobe”). I’ll suggest matching items you can add.",
      flowType: "none",
      flowContext: null,
    };
  }

  try {
    const { run: runWardrobeExtraction } = await import("./wardrobeExtractionAgent.js");
    const result = await runWardrobeExtraction(
      { imageUrl },
      { userId }
    );
    if (result.error && result.slots.length === 0) {
      return {
        reply: result.error === "No items detected in the image"
          ? "I couldn’t spot any clear clothing items in that image. Try a clearer photo of your outfit."
          : result.error,
        flowType: "none",
        flowContext: null,
      };
    }
    const slotCount = result.slots?.length ?? 0;
    const reply =
      slotCount > 0
        ? `I found ${slotCount} item${slotCount === 1 ? "" : "s"} in this look. Below are product suggestions for each—you can add any of them to your wardrobe.`
        : "I couldn’t find matching items for this look. Try another photo or add items manually from the wardrobe page.";
    return {
      reply,
      flowType: "wardrobe_extraction",
      flowContext: { slots: result.slots ?? [], look: result.look ?? null },
    };
  } catch (err) {
    console.warn("[router] wardrobe_extraction failed:", err?.message);
    return {
      reply: "I couldn’t extract items from that look right now. Try again or use the wardrobe page to add items from a look.",
      flowType: "none",
      flowContext: null,
    };
  }
}

/**
 * B5.5: Extract occasion string from user message for look planning.
 */
function extractOccasionFromMessage(message) {
  const text = (message || "").trim();
  if (!text) return "trip";
  const m1 = text.match(/\bplan\s+looks?\s+for\s+(.+?)(?:\?|\.|$)/i);
  if (m1) return m1[1].trim().slice(0, 150);
  const m2 = text.match(/\b(?:outfits?|looks?)\s+for\s+(?:a\s+)?(.+?)(?:\?|\.|$)/i);
  if (m2) return m2[1].trim().slice(0, 150);
  const m3 = text.match(/\b(?:need|want)\s+(?:some\s+)?(?:outfits?|looks?)\s+for\s+(.+?)(?:\?|\.|$)/i);
  if (m3) return m3[1].trim().slice(0, 150);
  const m4 = text.match(/\bpack(?:ing)?\s+for\s+(.+?)(?:\?|\.|$)/i);
  if (m4) return m4[1].trim().slice(0, 150);
  const m5 = text.match(/\b(?:what\s+to\s+wear|outfit\s+ideas?)\s+for\s+(.+?)(?:\?|\.|$)/i);
  if (m5) return m5[1].trim().slice(0, 150);
  return text.slice(0, 150);
}

/**
 * B5.5: Run Look Planning Agent and return conversation-shaped result.
 */
async function runLookPlanningForConversation(input, context) {
  const userId = context?.userId ?? null;
  const message = (input?.message || "").trim();
  const occasion = extractOccasionFromMessage(message);

  try {
    const { runLookPlanning } = await import("./lookPlanningAgent.js");
    const result = await runLookPlanning({
      occasion,
      userId: userId || undefined,
      generateImages: false,
    });
    const looks = result.looks ?? [];
    const planSummary = result.planSummary ?? null;
    const reply =
      looks.length > 0
        ? `I've planned ${looks.length} look${looks.length === 1 ? "" : "s"} for ${occasion}. ${planSummary || ""}`
        : `I couldn't generate looks for "${occasion}" right now. Try again with something like "Plan looks for my vacation" or "Outfits for a weekend trip".`;
    return {
      reply,
      flowType: "look_planning",
      flowContext: { looks, planSummary, occasion },
    };
  } catch (err) {
    console.warn("[router] look_planning failed:", err?.message);
    return {
      reply:
        "I couldn't plan looks right now. Try again with something like \"Plan looks for my vacation\" or \"Outfits for a weekend trip\".",
      flowType: "none",
      flowContext: null,
    };
  }
}

/**
 * B7.5: Run Match Agent (wishlist) and return conversation-shaped result.
 */
async function runMatchWishlistForConversation(input, context) {
  const userId = context?.userId;
  if (!userId) {
    return {
      reply: "Please sign in so I can analyze how your wishlist matches your style.",
      flowType: "none",
      flowContext: null,
    };
  }

  try {
    const { runMatchAnalysis } = await import("./matchAgent.js");
    const { listWishlist } = await import("../domain/preferences/preferences.js");

    const [wishlistResult, matchResult] = await Promise.all([
      listWishlist(userId),
      runMatchAnalysis({ userId }),
    ]);

    const items = wishlistResult?.items ?? [];
    if (items.length === 0) {
      return {
        reply: "Your wishlist is empty. Add some items you like, then ask me again to see how they match your style.",
        flowType: "match_wishlist",
        flowContext: { items: [], summary: null },
      };
    }

    const matchByWishlistId = new Map((matchResult.items ?? []).map((m) => [m.wishlistItemId, m]));
    const merged = items.map((w) => {
      const m = matchByWishlistId.get(w.id);
      return {
        ...w,
        matchSummary: m?.matchSummary ?? null,
        matchScore: m?.matchScore ?? null,
      };
    });

    const summary = matchResult.summary ?? null;
    const reply =
      summary ||
      (merged.length === 1
        ? "Here's how this item matches you."
        : `Here's how your ${merged.length} wishlist items match your style.`);

    return {
      reply,
      flowType: "match_wishlist",
      flowContext: { items: merged, summary: summary },
    };
  } catch (err) {
    console.warn("[router] match_wishlist failed:", err?.message);
    return {
      reply: "I couldn't analyze your wishlist right now. Try again later or check your wishlist on the app.",
      flowType: "none",
      flowContext: null,
    };
  }
}

/**
 * Route a user turn to the appropriate agent and return the agent result.
 * @param {{ message: string, imageUrls?: string[], history: Object[] }} input
 * @param {{ userId: string }} context
 * @returns {Promise<{ reply: string, flowType?: string, flowContext?: object }>}
 */
export async function route(input, context) {
  const intent = classifyIntent(input);

  if (intent === "match_wishlist") {
    return runMatchWishlistForConversation(input, context);
  }
  if (intent === "look_planning") {
    return runLookPlanningForConversation(input, context);
  }
  if (intent === "look_analyze") {
    return runLookAnalyzeForConversation(input, context);
  }
  if (intent === "style_report") {
    return runStyleReportForConversation(input, context);
  }
  if (intent === "wardrobe") {
    return runWardrobeExtractionForConversation(input, context);
  }
  if (intent === "search") {
    return runSearchAgent(input, context);
  }

  return runStylingAgent(input, context);
}
