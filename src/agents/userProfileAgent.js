/**
 * B3.1 User Profile Agent
 * Input: userId. Reads profile (style, history, quiz) from User Profile Service;
 * generates fashion need & motivation via LLM; validates; writes back via writeNeedMotivation.
 */

import { getUserProfile, writeNeedMotivation } from "../domain/userProfile/userProfile.js";
import { complete } from "../utils/llm.js";
import { normalizeId } from "../core/helpers.js";

const MAX_NEED_LENGTH = 500;
const MAX_MOTIVATION_LENGTH = 500;
const PROFILE_CONTEXT_MAX_CHARS = 1500;
const QUIZ_CONTEXT_MAX_CHARS = 800;
const LLM_MAX_TOKENS = 400;
const VALIDATE_MAX_TOKENS = 200;
const FALLBACK_NEED = "Exploring personal style.";
const FALLBACK_MOTIVATION = "Exploring personal style.";

/**
 * Run User Profile Agent: generate fashion need & motivation from profile and write back.
 * @param {Object} input - { userId: string }
 * @returns {Promise<{ need: string, motivation: string }>}
 */
export async function run(input) {
  const userId = input?.userId;
  const uid = normalizeId(userId);
  if (!uid) throw new Error("userId required");

  const profile = await getUserProfile(uid);
  if (!profile) throw new Error("User profile not found");

  const context = buildProfileContext(profile);
  let need = FALLBACK_NEED;
  let motivation = FALLBACK_MOTIVATION;

  const existingNeed = profile.fashionNeed?.text ?? null;
  const existingMotivation = profile.fashionMotivation?.text ?? null;

  try {
    const result = await complete(
      [
        {
          role: "system",
          content: `You are a fashion profile analyst. Given a user's style profile, history, and quiz (if any), infer their current fashion need and motivation.
Output only a JSON object with exactly two keys:
- "need": string, 1-3 sentences: what the user is looking for in fashion right now (e.g. occasion, style direction, gaps they want to fill).
- "motivation": string, 1-3 sentences: why they care about style and their goals (e.g. confidence, self-expression, an event).
Be concise and user-centric. If context is sparse, give a short generic but positive statement.`,
        },
        {
          role: "user",
          content: context,
        },
      ],
      { responseFormat: "json_object", maxTokens: LLM_MAX_TOKENS }
    );

    if (result && typeof result === "object") {
      if (typeof result.need === "string" && result.need.trim()) {
        need = result.need.trim().slice(0, MAX_NEED_LENGTH);
      } else if (existingNeed && existingNeed.trim()) {
        need = existingNeed.trim().slice(0, MAX_NEED_LENGTH);
      }
      if (typeof result.motivation === "string" && result.motivation.trim()) {
        motivation = result.motivation.trim().slice(0, MAX_MOTIVATION_LENGTH);
      } else if (existingMotivation && existingMotivation.trim()) {
        motivation = existingMotivation.trim().slice(0, MAX_MOTIVATION_LENGTH);
      }
    }

    // Validate: coherent and on-topic for fashion; use suggested fix if validator provides one
    const validation = await validateNeedAndMotivation(need, motivation, context.slice(0, 400));
    if (validation && !validation.ok) {
      if (typeof validation.suggestedNeed === "string" && validation.suggestedNeed.trim()) {
        need = validation.suggestedNeed.trim().slice(0, MAX_NEED_LENGTH);
      } else if (existingNeed && existingNeed.trim()) {
        need = existingNeed.trim().slice(0, MAX_NEED_LENGTH);
      }
      if (typeof validation.suggestedMotivation === "string" && validation.suggestedMotivation.trim()) {
        motivation = validation.suggestedMotivation.trim().slice(0, MAX_MOTIVATION_LENGTH);
      } else if (existingMotivation && existingMotivation.trim()) {
        motivation = existingMotivation.trim().slice(0, MAX_MOTIVATION_LENGTH);
      } else if (validation.reason) {
        console.warn("[userProfileAgent] Validation failed, using existing/fallback:", validation.reason);
      }
    }
  } catch (e) {
    console.warn("[userProfileAgent] LLM failed, using existing or fallback:", e?.message);
    if (existingNeed && existingNeed.trim()) need = existingNeed.trim().slice(0, MAX_NEED_LENGTH);
    if (existingMotivation && existingMotivation.trim()) motivation = existingMotivation.trim().slice(0, MAX_MOTIVATION_LENGTH);
  }

  await writeNeedMotivation(uid, { need, motivation });
  return { need, motivation };
}

/**
 * Validate that need and motivation are coherent and on-topic for fashion/personal style.
 * Returns { ok, reason?, suggestedNeed?, suggestedMotivation? }. If !ok, caller may use suggested* or fallback.
 */
async function validateNeedAndMotivation(need, motivation, profileSnippet) {
  try {
    const prompt = `You are a quality checker for fashion profile text.

Current "fashion need": ${(need || "").slice(0, 300)}
Current "fashion motivation": ${(motivation || "").slice(0, 300)}

Profile context (brief): ${(profileSnippet || "").slice(0, 350)}

Check: (1) Both are coherent and on-topic for personal style/fashion (not off-topic or gibberish). (2) Not overly generic to be meaningless. (3) Tone is appropriate (user-centric, positive).

Reply with JSON only:
- "ok": true if both pass; false if either should be improved.
- "reason": one short sentence why they fail (only if ok is false).
- "suggestedNeed": if ok is false and need should be fixed, provide a better 1-2 sentence need; else null.
- "suggestedMotivation": if ok is false and motivation should be fixed, provide a better 1-2 sentence motivation; else null.`;

    const out = await complete(
      [
        { role: "system", content: "You output only valid JSON. No markdown or preamble." },
        { role: "user", content: prompt },
      ],
      { responseFormat: "json_object", maxTokens: VALIDATE_MAX_TOKENS }
    );
    if (out && typeof out === "object") {
      return {
        ok: Boolean(out.ok),
        reason: typeof out.reason === "string" ? out.reason.trim() : null,
        suggestedNeed: typeof out.suggestedNeed === "string" ? out.suggestedNeed.trim() : null,
        suggestedMotivation: typeof out.suggestedMotivation === "string" ? out.suggestedMotivation.trim() : null,
      };
    }
  } catch (e) {
    console.warn("[userProfileAgent] Validation step failed:", e?.message);
  }
  return null;
}

function buildProfileContext(profile) {
  const parts = [];

  const styleData = profile.styleProfile?.data;
  if (styleData != null) {
    const raw = typeof styleData === "string" ? styleData : JSON.stringify(styleData);
    parts.push(`Style profile:\n${raw.slice(0, PROFILE_CONTEXT_MAX_CHARS)}${raw.length > PROFILE_CONTEXT_MAX_CHARS ? "…" : ""}`);
  } else {
    parts.push("Style profile: (none)");
  }

  const historySummary = profile.history?.summary;
  if (historySummary != null) {
    const raw = typeof historySummary === "string" ? historySummary : JSON.stringify(historySummary);
    parts.push(`History summary:\n${raw.slice(0, 500)}`);
  }

  const events = profile.history?.recentEvents;
  if (Array.isArray(events) && events.length > 0) {
    const types = {};
    for (const e of events) {
      const t = e?.eventType ?? "unknown";
      types[t] = (types[t] || 0) + 1;
    }
    parts.push(`Recent events (last 90 days): ${events.length} total. By type: ${JSON.stringify(types)}`);
  } else {
    parts.push("Recent events: none");
  }

  const quiz = profile.quiz?.responses;
  if (quiz != null) {
    const raw = typeof quiz === "string" ? quiz : JSON.stringify(quiz);
    parts.push(`Quiz responses:\n${raw.slice(0, QUIZ_CONTEXT_MAX_CHARS)}${raw.length > QUIZ_CONTEXT_MAX_CHARS ? "…" : ""}`);
  }

  const existingNeed = profile.fashionNeed?.text;
  const existingMotivation = profile.fashionMotivation?.text;
  if (existingNeed || existingMotivation) {
    parts.push(`Current need: ${existingNeed || "(none)"}`);
    parts.push(`Current motivation: ${existingMotivation || "(none)"}`);
  }

  return parts.join("\n\n");
}
