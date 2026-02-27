/**
 * B4.1 Look Analysis Agent (upgraded)
 * Input: look image (URL or buffer) or lookId. Image analysis → look + items;
 * fetch user profile + trends/rules; second LLM step → analysisComment + suggestions;
 * persist look via Looks API (create or update).
 */

import { analyzeImage } from "../utils/imageAnalysis.js";
import { uploadFile, resolveImageUrlForExternal } from "../utils/storage.js";
import { complete } from "../utils/llm.js";
import { randomUUID } from "crypto";
import * as lookDomain from "../domain/looks/look.js";
import { getUserProfile } from "../domain/userProfile/userProfile.js";
import { listTrends, listStylingRules } from "../domain/fashionContent/fashionContent.js";
import { listLookClassificationTags } from "../domain/lookClassificationTag/lookClassificationTag.js";
import { normalizeId } from "../core/helpers.js";

const LOOK_ANALYSIS_MAX_TOKENS = 800;
const LOOK_ANALYSIS_STEP_MAX_TOKENS = 1000;
const FAST_LOOK_MAX_TOKENS = 200;

const FAST_LOOK_PROMPT = `Analyze this fashion/outfit image. Return JSON only: { "look": { "shortTitle": "1-3 word descriptive title (e.g. Casual Summer, Bold Evening, Minimal Work)", "comment": "one short sentence", "vibe": "e.g. casual/formal", "occasion": "e.g. work/party", "timeOfDay": "day/evening" or null, "labels": ["tag1","tag2"] } }. Keep it brief. shortTitle must be 1-3 words that best describe the look.`;

/**
 * Run Look Analysis: analyze image → extract comment, vibe, occasion, timeOfDay → persist look.
 * @param {Object} input - { imageUrl?, imageBuffer?, lookId?, userId, fast? }
 * @param {boolean} [input.fast] - When true, skip second LLM step and context fetch for quick diary add (~1 LLM call instead of 2).
 * @returns {Promise<{ comment, vibe, occasion, timeOfDay, labels, analysisComment, suggestions, lookId, look }>}
 */
export async function run(input) {
  const { imageUrl, imageBuffer, contentType, lookId, userId, fast } = input;
  const uid = normalizeId(userId);

  let resolvedImageUrl = null;
  let existingLook = null;

  if (imageBuffer && Buffer.isBuffer(imageBuffer)) {
    const key = `looks/${uid || "anon"}/${randomUUID()}`;
    const ct = contentType || "image/jpeg";
    const { url } = await uploadFile(imageBuffer, key, ct, { requireRemote: false });
    resolvedImageUrl = url;
  } else if (imageUrl && typeof imageUrl === "string" && imageUrl.trim()) {
    resolvedImageUrl = imageUrl.trim();
  } else if (lookId && normalizeId(lookId)) {
    existingLook = await lookDomain.getLook(lookId);
    if (!existingLook) throw new Error("Look not found");
    resolvedImageUrl = existingLook.imageUrl;
    if (!resolvedImageUrl) throw new Error("Look has no image to analyze");
  }

  if (!resolvedImageUrl) {
    throw new Error("Provide imageUrl, imageBuffer, or lookId with an image");
  }

  const urlForVision = await resolveImageUrlForExternal(resolvedImageUrl);
  const analysis = await analyzeImage(urlForVision, {
    prompt: fast ? FAST_LOOK_PROMPT : undefined,
    responseFormat: "json_object",
    maxTokens: fast ? FAST_LOOK_MAX_TOKENS : LOOK_ANALYSIS_MAX_TOKENS,
  });

  const lookPart = analysis?.look ?? analysis;
  const itemsRaw = Array.isArray(analysis?.items) ? analysis.items : [];
  const shortTitle = lookPart?.shortTitle?.trim() || null;
  const comment =
    lookPart?.comment ?? lookPart?.description ?? "Nice look!";
  const vibe = lookPart?.vibe ?? null;
  const occasion = lookPart?.occasion ?? null;
  const timeOfDay = lookPart?.timeOfDay ?? lookPart?.time_of_day ?? null;
  const labels = Array.isArray(lookPart?.labels) ? lookPart.labels : [];

  const itemsSummary = itemsRaw.slice(0, 20).map((it) => ({
    type: it?.type ?? null,
    description: it?.description ?? null,
    category: it?.category_lvl1 ?? it?.category ?? null,
    color: it?.color_primary ?? it?.color_family ?? null,
    style: it?.style_family ?? it?.mood_vibe ?? null,
  }));

  let analysisComment = comment;
  let suggestions = [];
  let classificationTags = [];
  let shortSummary = null;

  if (!fast) {
    // Full analysis: fetch context + second LLM step
    let profile = null;
    let trends = [];
    let rules = [];
    let classificationTagList = [];
    try {
      const [profileRes, trendRes, ruleRes, tagRes] = await Promise.all([
        uid ? getUserProfile(uid) : null,
        listTrends({ limit: 15, status: "active" }).then((r) => r?.items ?? []),
        listStylingRules({ limit: 15, status: "active" }).then((r) => r?.items ?? []),
        listLookClassificationTags({ limit: 100 }).then((r) => r?.items ?? []),
      ]);
      profile = profileRes ?? null;
      trends = Array.isArray(trendRes) ? trendRes : [];
      rules = Array.isArray(ruleRes) ? ruleRes : [];
      classificationTagList = Array.isArray(tagRes) ? tagRes : [];
    } catch (e) {
      console.warn("[lookAnalysisAgent] profile/trends/rules/tags fetch failed:", e?.message);
    }

    try {
      const analysisResult = await runLookAnalysisStep({
        look: { comment, vibe, occasion, timeOfDay, labels },
        itemsSummary,
        profile,
        trends,
        rules,
        classificationTagList,
      });
      if (analysisResult?.analysisComment) analysisComment = String(analysisResult.analysisComment);
      if (analysisResult?.shortSummary) shortSummary = String(analysisResult.shortSummary).trim();
      if (Array.isArray(analysisResult?.suggestions)) suggestions = analysisResult.suggestions.slice(0, 10);
      if (Array.isArray(analysisResult?.classificationTags)) {
        const allowedNames = new Set(classificationTagList.map((t) => t.name));
        classificationTags = analysisResult.classificationTags.filter((n) => allowedNames.has(String(n))).slice(0, 10);
      }
    } catch (e) {
      console.warn("[lookAnalysisAgent] analysis step failed:", e?.message);
    }
  }

  if (!shortSummary && analysisComment) {
    shortSummary = suggestions?.length ? `${analysisComment.slice(0, 80)} ${suggestions[0]}`.trim().slice(0, 200) : analysisComment;
  }

  const lookData = {
    shortTitle: shortTitle ?? (vibe && occasion ? `${vibe} ${occasion}`.trim() : vibe ?? occasion),
    comment,
    timeOfDay,
    labels,
    analyzedAt: new Date().toISOString(),
    analysisComment,
    suggestions,
    itemsSummary,
    classificationTags,
    shortSummary: shortSummary || null,
  };

  let look;
  if (existingLook && uid && existingLook.userId === uid) {
    look = await lookDomain.updateLook(existingLook.id, {
      imageUrl: resolvedImageUrl,
      vibe,
      occasion,
      lookData: JSON.stringify(lookData),
    });
  } else {
    if (!uid) throw new Error("userId required to create a look");
    look = await lookDomain.createLook({
      userId: uid,
      imageUrl: resolvedImageUrl,
      vibe,
      occasion,
      lookData: JSON.stringify(lookData),
    });
  }

  return {
    comment,
    vibe: vibe ?? null,
    occasion: occasion ?? null,
    timeOfDay: timeOfDay ?? null,
    labels,
    analysisComment,
    suggestions,
    classificationTags,
    lookId: look.id,
    look: {
      id: look.id,
      imageUrl: look.imageUrl,
      vibe: look.vibe,
      occasion: look.occasion,
      lookData: look.lookData,
      createdAt: look.createdAt?.toISOString?.() ?? look.createdAt,
      updatedAt: look.updatedAt?.toISOString?.() ?? look.updatedAt,
    },
  };
}

/**
 * Second LLM step: compare look + items to user profile, fashion trends/rules, and classification tags;
 * return { analysisComment, suggestions, classificationTags }.
 */
async function runLookAnalysisStep({ look, itemsSummary, profile, trends, rules, classificationTagList }) {
  const profileSnippet = profile
    ? JSON.stringify({
        styleProfile: profile.styleProfile?.data ?? null,
        fashionNeed: profile.fashionNeed?.text ?? null,
        fashionMotivation: profile.fashionMotivation?.text ?? null,
      })
    : "No user profile available.";
  const trendsSnippet =
    trends.length > 0
      ? trends
          .slice(0, 10)
          .map((t) => `- ${t.trendName}: ${t.description || t.keywords || ""}`)
          .join("\n")
      : "No active trends provided.";
  const rulesSnippet =
    rules.length > 0
      ? rules
          .slice(0, 10)
          .map((r) => `- ${r.title || "Rule"}: ${(r.body || "").slice(0, 200)}`)
          .join("\n")
      : "No styling rules provided.";
  const tagNamesList =
    classificationTagList.length > 0
      ? classificationTagList.map((t) => t.name).join(", ")
      : "casual, formal, work, weekend, party, vacation, date-night, streetwear, minimal, bold, sporty, elegant, cozy, edgy, classic, trendy, bohemian, preppy, athleisure, smart-casual";

  const system = `You are a fashion stylist. Given a look (outfit) description, the items in it, the user's style profile and needs, current fashion trends and styling rules, and a list of allowed classification tag names, produce a short analysis, concrete improvement suggestions, which classification tags best fit this look, and a single shortSummary.
Output only a single JSON object with exactly four keys:
- "analysisComment": string, 2-4 sentences: validate the look, note how it fits the user's profile and current trends/rules, and give brief encouragement or nuance.
- "suggestions": array of 2-5 strings, each one concrete improvement (e.g. "Try a slightly higher waist to elongate the silhouette" or "This occasion calls for a more structured blazer").
- "classificationTags": array of 1-5 strings: each must be exactly one of the allowed tag names provided. Pick the tags that best classify this look (e.g. occasion, vibe, style). Use only the exact names from the list.
- "shortSummary": string, 25-30 words. Combine: what the look is, key validation, and top 1-2 practical suggestions. No filler. Be concise and actionable.`;

  const user = `Look: vibe=${look.vibe ?? "unspecified"}, occasion=${look.occasion ?? "unspecified"}, timeOfDay=${look.timeOfDay ?? "unspecified"}, labels=${(look.labels || []).join(", ") || "none"}. Brief description: ${look.comment || "—"}

Items in the look (up to 20):
${JSON.stringify(itemsSummary, null, 0)}

User profile (style, need, motivation):
${profileSnippet}

Active fashion trends:
${trendsSnippet}

Styling rules:
${rulesSnippet}

Allowed classification tag names (use only these exact strings in classificationTags): ${tagNamesList}

Respond with JSON only: { "analysisComment": "...", "suggestions": ["...", "..."], "classificationTags": ["tag1", "tag2"], "shortSummary": "25-30 word concise summary" }`;

  const out = await complete(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { responseFormat: "json_object", maxTokens: LOOK_ANALYSIS_STEP_MAX_TOKENS }
  );
  return out && typeof out === "object" ? out : {};
}
