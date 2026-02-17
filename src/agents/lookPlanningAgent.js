/**
 * B5.1 Look Planning Agent
 * Input: occasion (e.g. vacation), constraints. Uses LLM + Look Composition Service
 * to produce a planned set of looks with diversity. Validate coherence.
 */

import { complete } from "../utils/llm.js";
import { getUserProfile } from "../domain/userProfile/userProfile.js";
import { buildUserContextFromProfile } from "../domain/userProfile/contextForAgents.js";
import { composeLook } from "../domain/lookComposition/lookComposition.js";

const MIN_LOOKS = 1;
const MAX_LOOKS = 10;
const DEFAULT_LOOKS = 5;
const VALIDATE_COHERENCE_MAX_TOKENS = 200;
const VALIDATE_LOOKS_CAP = 10;
/** Max concurrent composeLook calls to reduce latency without overloading LLM/Replicate. */
const COMPOSE_LOOK_CONCURRENCY = 3;

/**
 * Validate that the planned set of looks is diverse and coherent for the occasion.
 * @param {string} occasion
 * @param {Array<{ label?: string, vibe?: string, occasion?: string }>} looks
 * @returns {Promise<{ ok: boolean, reason: string | null } | null>} null on LLM/parse failure
 */
async function validatePlannedSetCoherence(occasion, looks) {
  try {
    const list = (looks || []).slice(0, VALIDATE_LOOKS_CAP).map((l, i) => ({
      index: i + 1,
      label: (l.label || "").slice(0, 80),
      vibe: (l.vibe || "").slice(0, 60),
      occasion: (l.occasion || "").slice(0, 60),
    }));
    const prompt = `You are a quality checker for a fashion look plan.

Occasion: ${(occasion || "").slice(0, 120)}

Planned looks:
${list.map((l) => `[${l.index}] label: ${l.label}, vibe: ${l.vibe}, occasion: ${l.occasion}`).join("\n")}

Are these looks diverse and coherent for this occasion? (Diverse = different activities/formality; coherent = all fit the occasion.)
Reply with JSON only: { "ok": boolean, "reason": string | null }. If not ok, reason should briefly explain (e.g. too similar, not suited to occasion).`;

    const out = await complete(
      [
        { role: "system", content: "You output only valid JSON. No markdown or preamble." },
        { role: "user", content: prompt },
      ],
      { responseFormat: "json_object", maxTokens: VALIDATE_COHERENCE_MAX_TOKENS }
    );
    if (out && typeof out === "object") {
      return {
        ok: Boolean(out.ok),
        reason: typeof out.reason === "string" ? out.reason.trim() : null,
      };
    }
  } catch (e) {
    console.warn("[lookPlanningAgent] validatePlannedSetCoherence failed:", e?.message);
  }
  return null;
}

/**
 * Run Look Planning: plan diverse looks for an occasion, then build each look via Look Composition.
 * @param {Object} opts
 * @param {string} opts.occasion - e.g. "vacation", "weekend trip", "business trip"
 * @param {number} [opts.numberOfLooks] - how many looks to plan (default 5, max 10)
 * @param {string} [opts.vibe] - optional overall vibe
 * @param {number} [opts.days] - optional trip length (hint for diversity)
 * @param {string} [opts.userId] - optional; if set, user profile is used for preferred vibe/occasion
 * @param {boolean} [opts.generateImages] - if true, generate image per look (slower)
 * @param {string} [opts.imageStyle] - "flat_lay" | "on_model" for generated images
 * @returns {Promise<{ looks: Array<{ label, vibe, occasion, products, productIds, imageUrl?, lookImageStyle }>, planSummary?: string }>}
 */
export async function runLookPlanning(opts = {}) {
  const {
    occasion,
    numberOfLooks = DEFAULT_LOOKS,
    vibe: overallVibe,
    days,
    userId,
    generateImages = false,
    imageStyle = "flat_lay",
  } = opts;

  const occasionStr = (occasion || "").trim();
  if (!occasionStr) {
    throw new Error("occasion is required");
  }

  const numLooks = Math.min(
    MAX_LOOKS,
    Math.max(MIN_LOOKS, Number(numberOfLooks) || DEFAULT_LOOKS)
  );

  let userContext;
  if (userId) {
    const profile = await getUserProfile(userId);
    userContext = buildUserContextFromProfile(profile);
  }

  const prompt = `You are a fashion stylist planning outfit looks for a trip or occasion.

Occasion: ${occasionStr}
${overallVibe ? `Overall vibe: ${overallVibe}` : ""}
${days ? `Trip length: ${days} days` : ""}

Suggest exactly ${numLooks} distinct looks that together cover the occasion with diversity (e.g. different activities, times of day, or formality). Each look should have a short label, a vibe, and an occasion/sub-occasion.

Respond with a JSON object only:
{ "looks": [ { "label": "short label e.g. Day 1 casual explore", "vibe": "e.g. casual, relaxed", "occasion": "e.g. day out, sightseeing" }, ... ] }
Provide exactly ${numLooks} items. Keep labels short (under 40 chars). Vibe and occasion should be one or two words each.`;

  const messages = [{ role: "user", content: prompt }];
  const out = await complete(messages, { responseFormat: "json_object", maxTokens: 800 });
  let plannedSlots = [];
  try {
    const parsed = typeof out === "string" ? JSON.parse(out) : out;
    const list = parsed?.looks;
    if (Array.isArray(list) && list.length > 0) {
      plannedSlots = list
        .slice(0, numLooks)
        .filter((s) => s && (s.label || s.vibe || s.occasion))
        .map((s) => ({
          label: String(s.label || "Look").trim().slice(0, 80),
          vibe: String(s.vibe || overallVibe || "").trim().slice(0, 100) || null,
          occasion: String(s.occasion || "").trim().slice(0, 100) || null,
        }));
    }
  } catch (e) {
    console.warn("[lookPlanningAgent] LLM parse failed:", e.message);
  }

  if (plannedSlots.length === 0) {
    plannedSlots = [{ label: occasionStr, vibe: overallVibe || null, occasion: occasionStr }];
  }

  const looks = [];
  const imageStyleResolved = imageStyle === "on_model" ? "on_model" : "flat_lay";
  for (let i = 0; i < plannedSlots.length; i += COMPOSE_LOOK_CONCURRENCY) {
    const chunk = plannedSlots.slice(i, i + COMPOSE_LOOK_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((slot) =>
        composeLook({
          vibe: slot.vibe || overallVibe || undefined,
          occasion: slot.occasion || occasionStr,
          userContext,
          generateImage: Boolean(generateImages),
          imageStyle: imageStyleResolved,
        })
      )
    );
    results.forEach((result, j) => {
      const slot = chunk[j];
      if (result.status === "fulfilled") {
        const composed = result.value;
        looks.push({
          label: slot.label,
          vibe: composed.vibe ?? slot.vibe,
          occasion: composed.occasion ?? slot.occasion,
          products: composed.products ?? [],
          productIds: composed.productIds ?? [],
          imageUrl: composed.imageUrl ?? null,
          lookImageStyle: composed.lookImageStyle ?? imageStyleResolved,
        });
      } else {
        console.warn("[lookPlanningAgent] composeLook failed for slot:", slot.label, result.reason?.message);
        looks.push({
          label: slot.label,
          vibe: slot.vibe,
          occasion: slot.occasion,
          products: [],
          productIds: [],
          imageUrl: null,
          lookImageStyle: imageStyleResolved,
          error: result.reason?.message ?? "Unknown error",
        });
      }
    });
  }

  let planSummary = `${occasionStr}: ${looks.length} look(s) planned`;
  const validation = await validatePlannedSetCoherence(occasionStr, looks);
  if (validation && validation.ok === false && validation.reason) {
    planSummary += ` (Validation: limited diversity — ${validation.reason})`;
  }

  return {
    looks,
    planSummary,
  };
}
