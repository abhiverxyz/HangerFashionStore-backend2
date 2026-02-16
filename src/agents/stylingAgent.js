/**
 * B2.4 Styling Agent
 * Interprets intent from message (+ optional image) and conversation history;
 * uses Look Composition, product list/search, User Profile, Fashion Content, LLM;
 * generates reply + cards (looks, products, tips, makeupHair); validates reply vs intent.
 * Implements 1.4 Get ready + 1.8 General styling.
 * Supports: pairing (anchor product), validate_outfit (how do I look?), NL product search, makeup/hair tips.
 */

import { complete } from "../utils/llm.js";
import { analyzeImage } from "../utils/imageAnalysis.js";
import { getUserProfile } from "../domain/userProfile/userProfile.js";
import { listTrends, listStylingRules } from "../domain/fashionContent/fashionContent.js";
import { composeLook } from "../domain/lookComposition/lookComposition.js";
import { listProducts } from "../domain/product/product.js";
import { buildStylingAgentContext } from "../domain/stylingAgentConfig/stylingAgentConfig.js";

const INTENT_EXTRACT_MAX_TOKENS = 600;
const REPLY_MAX_TOKENS = 400;
const VALIDATE_MAX_TOKENS = 200;
const HISTORY_MESSAGES_FOR_INTENT = 5;
const OUTFIT_FEEDBACK_MAX_TOKENS = 300;

const VALIDATE_OUTFIT_PROMPT = `Analyze this outfit image. Return a single JSON object with: "description" (short outfit description), "vibe" (string), "occasion" (string), "comment" (one short sentence: validation, encouragement, or one concrete suggestion), "hair" (string or null), "makeup" (string or null).`;

/**
 * Build userContext for Look Composition from getUserProfile result.
 */
function buildUserContextFromProfile(profile) {
  if (!profile) return undefined;
  const data = profile.styleProfile?.data;
  const preferredVibe =
    (data && typeof data === "object" && data.vibe) ||
    (typeof data === "string" && data.trim()) ||
    null;
  const preferredOccasion = (data && typeof data === "object" && data.occasion) || null;
  const out = {};
  if (preferredVibe) out.preferredVibe = preferredVibe;
  if (preferredOccasion) out.preferredOccasion = preferredOccasion;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Format last N messages from history for context (for intent extraction).
 */
function formatHistoryForIntent(history) {
  if (!Array.isArray(history) || history.length === 0) return "";
  const recent = history.slice(-HISTORY_MESSAGES_FOR_INTENT);
  return recent
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${(m.content || "").slice(0, 150)}`)
    .join("\n");
}

/**
 * Resolve look image style from preference and journey (history).
 * When "auto": first message / no prior assistant in history → on_model (discovery); follow-up → flat_lay.
 */
function resolveLookImageStyle(lookDisplayPreference, history) {
  if (lookDisplayPreference === "on_model" || lookDisplayPreference === "flat_lay") {
    return lookDisplayPreference;
  }
  const hasPriorAssistant = Array.isArray(history) && history.some((m) => m.role === "assistant");
  return hasPriorAssistant ? "flat_lay" : "on_model";
}

/** Match "what should I wear (for X)?", "outfit for X", "what to wear for X" for intent safeguard. */
const WHAT_SHOULD_I_WEAR_REGEX = /\b(what should I wear|what to wear|outfit for|wear for)\b.*?(?:for|to)\s+([a-z0-9\s]+?)(?:\?|$)/i;

/**
 * If message is discovery-style ("what should I wear for office?"), nudge intent to suggest_look and set occasion.
 */
function nudgeIntentForDiscovery(text, extracted) {
  const m = text.match(WHAT_SHOULD_I_WEAR_REGEX);
  if (!m) return extracted;
  const occasionFromMessage = m[2].trim();
  if (!occasionFromMessage) return extracted;
  const intent = extracted?.intent || "general";
  if (intent !== "suggest_look" && (intent === "suggest_items" || intent === "general")) {
    return {
      ...extracted,
      intent: "suggest_look",
      occasion: extracted?.occasion || occasionFromMessage,
      lookDisplayPreference: extracted?.lookDisplayPreference === "flat_lay" ? "flat_lay" : "auto",
    };
  }
  return extracted;
}

/**
 * Filter styling rules that mention makeup or hair (subject, title, or body).
 */
function filterMakeupHairRules(rules) {
  if (!Array.isArray(rules)) return [];
  const lower = (s) => (s && String(s).toLowerCase()) || "";
  return rules.filter((r) => {
    const sub = lower(r.subject);
    const title = lower(r.title);
    const body = lower(r.body);
    return sub.includes("makeup") || sub.includes("hair") || title.includes("makeup") || title.includes("hair") || body.includes("makeup") || body.includes("hair");
  });
}

/**
 * Run the Styling Agent: generate reply + cards from user message, optional image(s), and history.
 */
export async function run(input, context) {
  const { message, imageUrls, history } = input;
  const imageUrlList = Array.isArray(imageUrls) ? imageUrls.filter((u) => u != null && String(u).trim() !== "").map(String) : [];
  const userId = context?.userId;
  const text = (message || "").trim();
  if (!text) {
    return {
      reply: "What would you like help with today? I can suggest looks, items, or share styling tips.",
      flowType: "none",
      flowContext: null,
    };
  }

  let profile = null;
  let trends = [];
  let rules = [];
  try {
    if (userId) profile = await getUserProfile(userId);
    const [trendRes, ruleRes] = await Promise.all([
      listTrends({ limit: 5, status: "active" }),
      listStylingRules({ limit: 10, status: "active" }),
    ]);
    trends = trendRes?.items ?? [];
    rules = ruleRes?.items ?? [];
  } catch (e) {
    console.warn("[stylingAgent] profile/trends/rules load failed:", e?.message);
  }

  const userContext = buildUserContextFromProfile(profile);
  const historyContext = formatHistoryForIntent(history);

  let agentContextBlock = "";
  try {
    agentContextBlock = await buildStylingAgentContext();
  } catch (e) {
    console.warn("[stylingAgent] buildStylingAgentContext failed:", e?.message);
  }

  let intent = "general";
  let vibe = null;
  let occasion = null;
  let category = null;
  let anchorProductId = null;
  let searchQuery = null;
  let oneLineReply = null;

  const intentPrompt = `Extract styling intent from this message${imageUrlList.length > 0 ? " and the attached image(s)" : ""}. Use conversation history for refinement (e.g. "more casual", "different one").
Reply with JSON only: {
  "intent": "suggest_look"|"suggest_items"|"trends"|"general"|"pairing"|"validate_outfit",
  "vibe": string or null,
  "occasion": string or null,
  "category": string or null,
  "anchorProductId": string or null (if user asks to build look around a specific product),
  "searchQuery": string or null (natural language product search, e.g. "blue dress", "white sneakers"),
  "lookDisplayPreference": "on_model"|"flat_lay"|"auto"|null (on_model = show outfit on a person; flat_lay = items laid out; auto = pick from context),
  "oneLineReply": one short friendly sentence to start the assistant reply
}
Use "pairing" when user wants matching/complementary items for something they have. Use "validate_outfit" when user is asking for feedback on their outfit (e.g. "how do I look?", "what do you think?"). When the user asks what to wear for an occasion (e.g. "what should I wear for office?", "outfit for dinner"), use intent: suggest_look, set occasion (and vibe if clear), and lookDisplayPreference: auto or on_model; do not use suggest_items for these discovery-style questions. For lookDisplayPreference: use "on_model" if user says "on a model", "worn look", "how it looks on someone"; use "flat_lay" if "flat lay", "show the pieces", "just the items"; otherwise "auto".${historyContext ? `\n\nRecent conversation:\n${historyContext}` : ""}\n\nCurrent user message: ${text}`;

  let lookDisplayPreference = null;
  try {
    const content = [];
    for (const url of imageUrlList) {
      content.push({ type: "image_url", image_url: { url } });
    }
    content.push({ type: "text", text: intentPrompt });
    const systemContent =
      agentContextBlock.trim() !== ""
        ? `${agentContextBlock.trim()}\n\nYou are a fashion styling assistant. Output valid JSON only.`
        : "You are a fashion styling assistant. Output valid JSON only.";
    const extracted = await complete(
      [
        { role: "system", content: systemContent },
        { role: "user", content: content.length === 1 ? content[0].text : content },
      ],
      { responseFormat: "json_object", maxTokens: INTENT_EXTRACT_MAX_TOKENS }
    );
    let resolved = extracted && typeof extracted === "object" ? extracted : {};
    resolved = nudgeIntentForDiscovery(text, resolved);
    if (resolved && typeof resolved === "object") {
      intent = resolved.intent || intent;
      vibe = resolved.vibe ?? null;
      occasion = resolved.occasion ?? null;
      category = resolved.category ?? null;
      anchorProductId = resolved.anchorProductId ?? null;
      searchQuery = resolved.searchQuery ?? null;
      lookDisplayPreference = resolved.lookDisplayPreference ?? null;
      oneLineReply = resolved.oneLineReply ?? null;
    }
  } catch (e) {
    console.warn("[stylingAgent] intent extraction failed:", e?.message);
  }

  const resolvedImageStyle = resolveLookImageStyle(lookDisplayPreference, history);

  const cards = { looks: [], products: [], tips: [], makeupHair: [] };

  // validate_outfit: user sent outfit image(s), want feedback (use first image for analysis)
  const firstImageUrl = imageUrlList.length > 0 ? imageUrlList[0] : null;
  if (intent === "validate_outfit" && firstImageUrl) {
    try {
      const analysis = await analyzeImage(firstImageUrl, {
        prompt: VALIDATE_OUTFIT_PROMPT,
        responseFormat: "json_object",
        maxTokens: OUTFIT_FEEDBACK_MAX_TOKENS,
      });
      const comment = analysis?.comment || "You look great!";
      const desc = analysis?.description;
      const lookVibe = analysis?.vibe;
      const lookOccasion = analysis?.occasion;
      oneLineReply = comment;
      if (desc) oneLineReply += " " + desc;
      if (lookVibe || lookOccasion) {
        const look = await composeLook({
          vibe: lookVibe || vibe || undefined,
          occasion: lookOccasion || occasion || undefined,
          constraints: {},
          userContext,
          generateImage: false,
        });
      if (look?.products?.length) {
        cards.looks.push({
          type: "look",
          vibe: look.vibe,
          occasion: look.occasion,
          products: look.products,
          productIds: look.productIds,
          imageUrl: null,
          lookImageStyle: look.lookImageStyle ?? "flat_lay",
        });
      }
    }
    if (analysis?.hair || analysis?.makeup) {
        cards.makeupHair.push(
          ...[
            analysis.hair && { type: "hair", text: analysis.hair },
            analysis.makeup && { type: "makeup", text: analysis.makeup },
          ].filter(Boolean)
        );
      }
    } catch (e) {
      console.warn("[stylingAgent] validate_outfit failed:", e?.message);
      oneLineReply = oneLineReply || "I’d love to give feedback—could you share a clear photo of your outfit?";
    }
  }

  const runLook =
    intent === "suggest_look" ||
    intent === "pairing" ||
    (intent === "general" && (vibe || occasion || anchorProductId)) ||
    (intent === "validate_outfit" && !firstImageUrl);
  if (runLook && !cards.looks.length) {
    try {
      const look = await composeLook({
        vibe: vibe || undefined,
        occasion: occasion || undefined,
        anchorProductId: anchorProductId || undefined,
        constraints: category ? { category_lvl1: category } : {},
        userContext,
        generateImage: true,
        imageStyle: resolvedImageStyle,
      });
      if (look?.products?.length) {
        cards.looks.push({
          type: "look",
          vibe: look.vibe,
          occasion: look.occasion,
          products: look.products,
          productIds: look.productIds,
          imageUrl: look.imageUrl || null,
          lookImageStyle: look.lookImageStyle ?? resolvedImageStyle,
        });
      }
    } catch (e) {
      console.warn("[stylingAgent] composeLook failed:", e?.message);
    }
  }

  const runProducts =
    intent === "suggest_items" ||
    (intent === "general" && !cards.looks.length) ||
    (intent === "pairing" && !cards.looks.length);
  if (runProducts) {
    try {
      const productOpts = {
        limit: 6,
        category_lvl1: category || undefined,
        occasion_primary: occasion || undefined,
        mood_vibe: vibe || undefined,
      };
      if (searchQuery && String(searchQuery).trim()) productOpts.search = String(searchQuery).trim();
      const { items } = await listProducts(productOpts);
      if (items?.length) {
        cards.products = items.slice(0, 6).map((p) => ({
          id: p.id,
          title: p.title,
          brandName: p.brand?.name ?? null,
          imageUrl: p.images?.[0]?.src ?? null,
          handle: p.handle,
        }));
      }
    } catch (e) {
      console.warn("[stylingAgent] listProducts failed:", e?.message);
    }
  }

  // Add tips when user asked for trends, or whenever we have trends/rules (so we return something even if look/products failed)
  if (intent === "trends" || trends.length > 0 || rules.length > 0) {
    cards.tips = [
      ...trends.slice(0, 2).map((t) => ({ type: "trend", title: t.trendName, description: t.description || null })),
      ...rules.slice(0, 2).map((r) => ({ type: "tip", title: r.title ?? r.body?.slice(0, 50), body: r.body || null })),
    ].filter((t) => t.title);
  }

  if (cards.makeupHair.length === 0) {
    const makeupHairRules = filterMakeupHairRules(rules);
    if (makeupHairRules.length) {
      cards.makeupHair = makeupHairRules.slice(0, 2).map((r) => ({
        type: r.subject && String(r.subject).toLowerCase().includes("hair") ? "hair" : "makeup",
        title: r.title,
        text: r.body || r.title,
      }));
    } else if (cards.looks.length && (vibe || occasion)) {
      cards.makeupHair.push({
        type: "makeup",
        text: `Keep hair and makeup in line with the ${vibe || occasion || "outfit"} vibe—simple and cohesive.`,
      });
    }
  }

  let reply = oneLineReply || "Here are some ideas for you.";
  if (cards.looks.length) reply += " I put together a look that fits.";
  if (cards.products.length) reply += " Here are some items you might like.";
  if (cards.tips.length) reply += " I also included a few trends and tips.";
  if (cards.makeupHair.length) reply += " I added hair and makeup suggestions.";
  reply = reply.trim();

  const validateResult = await validateReplyAgainstIntent(text, intent, reply, cards);
  if (validateResult && !validateResult.ok && validateResult.suggestedFix) {
    reply = validateResult.suggestedFix.trim();
  }

  const hasCards =
    cards.looks.length > 0 ||
    cards.products.length > 0 ||
    cards.tips.length > 0 ||
    cards.makeupHair.length > 0;
  return {
    reply,
    flowType: hasCards ? "styling_cards" : "none",
    flowContext: hasCards ? cards : null,
  };
}

/**
 * Validate that the reply matches user intent; optionally return a suggested fix.
 */
async function validateReplyAgainstIntent(userMessage, intent, reply, cards) {
  try {
    const hasLook = cards.looks?.length > 0;
    const hasProducts = cards.products?.length > 0;
    const hasTips = cards.tips?.length > 0;
    const prompt = `User said: "${userMessage.slice(0, 200)}". Intent: ${intent}. Assistant replied: "${reply.slice(0, 300)}". Cards: looks=${hasLook}, products=${hasProducts}, tips=${hasTips}. Does this reply match the user's intent and are the suggestions appropriate? Reply JSON only: { "ok": boolean, "suggestedFix": string or null (if !ok, one improved reply sentence) }.`;
    const out = await complete(
      [
        { role: "system", content: "You are a quality checker. Output valid JSON only." },
        { role: "user", content: prompt },
      ],
      { responseFormat: "json_object", maxTokens: VALIDATE_MAX_TOKENS }
    );
    return out && typeof out === "object" ? out : null;
  } catch (e) {
    return null;
  }
}
