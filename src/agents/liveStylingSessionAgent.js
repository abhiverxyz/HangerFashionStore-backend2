/**
 * Live Styling Session Agent
 * State machine + LLM for step-by-step "Get Ready With Me" camera-first styling.
 * States: INTRO → INTENT → CONSTRAINTS → BASE_ITEM → OUTFIT_BUILD → PAIRING → POLISH → HAIR_MAKEUP → FINAL_VALIDATE → DONE.
 */

import { complete } from "../utils/llm.js";
import { getUserProfile, getLatestStyleReport } from "../domain/userProfile/userProfile.js";
import { normalizeId } from "../core/helpers.js";

const SESSION_STATES = [
  "INTRO",
  "INTENT",
  "CONSTRAINTS",
  "BASE_ITEM",
  "OUTFIT_BUILD",
  "PAIRING",
  "POLISH",
  "HAIR_MAKEUP",
  "FINAL_VALIDATE",
  "DONE",
];

const CONTEXT_MAX_CHARS = 800;

function buildSessionContext(profile, styleReportResult, visionSignals) {
  const parts = [];
  if (profile?.summary?.overall) {
    parts.push(`User profile: ${String(profile.summary.overall).slice(0, 300)}`);
  }
  if (profile?.personalInsight) {
    parts.push(`Insight: ${String(profile.personalInsight).slice(0, 150)}`);
  }
  if (styleReportResult?.reportData?.headline) {
    parts.push(`Style report: ${String(styleReportResult.reportData.headline).slice(0, 120)}`);
  }
  if (visionSignals && typeof visionSignals === "object") {
    if (visionSignals.personDetected === false || visionSignals.outfitDetected === false) {
      parts.push("Vision: No person or outfit clearly detected in the last image. Suggest stepping back, improving lighting, or holding the camera steady.");
    } else {
      const g = visionSignals.garments;
      if (Array.isArray(g) && g.length > 0) {
        parts.push(`Visible items: ${g.map((x) => `${x.label || x.type} (${x.color || "?"})`).join(", ")}`);
      }
      if (Array.isArray(visionSignals.palette) && visionSignals.palette.length > 0) {
        parts.push(`Palette: ${visionSignals.palette.join(", ")}`);
      }
      if (Array.isArray(visionSignals.vibe) && visionSignals.vibe.length > 0) {
        parts.push(`Vibe: ${visionSignals.vibe.join(", ")}`);
      }
      if (Array.isArray(visionSignals.occasionGuess) && visionSignals.occasionGuess.length > 0) {
        parts.push(`Occasion guess: ${visionSignals.occasionGuess.join(", ")}`);
      }
      if (Array.isArray(visionSignals.notes) && visionSignals.notes.length > 0) {
        parts.push(`Notes: ${visionSignals.notes.join("; ")}`);
      }
    }
  }
  const context = parts.join("\n");
  return context.length > CONTEXT_MAX_CHARS ? context.slice(0, CONTEXT_MAX_CHARS) + "…" : context;
}

/**
 * Return the initial INTRO response for a new session (greeting + first instruction).
 * @returns {Promise<{ state: string, assistant: { text: string, speak: boolean }, ui: { stepTitle: string, instruction: string, chips?: string[] } }>}
 */
export async function getIntroResponse() {
  return {
    state: "INTRO",
    assistant: {
      text: "Hi — want to get ready together? What are we dressing for today?",
      speak: true,
    },
    ui: {
      stepTitle: "Let's begin",
      instruction: "Tell me the occasion or vibe, or tap Analyze when you're in frame.",
      chips: ["Casual hangout", "Office", "Date night", "Party", "Travel"],
    },
  };
}

/**
 * Compute next state and assistant response from user message and/or latest vision analysis.
 * @param {string} userId
 * @param {object} session - StylingSession record: currentState, stateHistory, messages, lastAnalysisId
 * @param {object} opts - { userMessage?: string, analysisId?: string, visionSignals?: object, clientContext?: { timezone?, locale? } }
 * @returns {Promise<{ state: string, assistant: { text: string, speak: boolean }, ui: { stepTitle: string, instruction: string, chips: string[] } }>}
 */
export async function getAssistantResponse(userId, session, opts = {}) {
  const uid = normalizeId(userId);
  const currentState = session.currentState || "INTRO";
  const userMessage = opts.userMessage != null ? String(opts.userMessage).trim() : "";
  const visionSignals = opts.visionSignals || null;

  const [profile, styleReportResult] = await Promise.all([
    uid ? getUserProfile(uid) : null,
    uid ? getLatestStyleReport(uid) : null,
  ]);

  const context = buildSessionContext(profile, styleReportResult, visionSignals);
  const stateHistory = Array.isArray(session.stateHistory) ? session.stateHistory : [];
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const recentMessages = messages.slice(-10).map((m) => `${m.role || "user"}: ${m.content || ""}`).join("\n");

  const userPrompt = [
    `Current session state: ${currentState}.`,
    context && `Context:\n${context}`,
    recentMessages && `Recent messages:\n${recentMessages}`,
    userMessage && `User said: "${userMessage}"`,
    opts.analysisId && "User just submitted a photo analysis (vision signals are in context).",
  ]
    .filter(Boolean)
    .join("\n\n");

  const systemPrompt = `You are a supportive personal stylist in a live "Get Ready With Me" session. Rules:
- Stay supportive and encouraging; never insulting.
- Keep your reply to 1-2 short sentences (under ~30 words for the main text).
- Always output valid JSON with: state, assistant (text, speak), ui (stepTitle, instruction, chips).
- state must be one of: ${SESSION_STATES.join(", ")}. Move forward (e.g. INTRO→INTENT→CONSTRAINTS→BASE_ITEM→OUTFIT_BUILD→PAIRING→POLISH→HAIR_MAKEUP→FINAL_VALIDATE→DONE) when the user has given enough input for the current step. "Try another" or re-analyze keeps the same state. If the user says "skip to makeup" use HAIR_MAKEUP; "just validate" use FINAL_VALIDATE.
- stepTitle: short step name (e.g. "Step 2: Occasion", "Step 6: Pairing").
- instruction: one short sentence for what to do next.
- chips: 0-4 short suggestion buttons (e.g. "Structured bag", "Gold hoops", "Skip").
- If vision context says no person/outfit detected, suggest improving framing or lighting and keep the same state.
- Ground suggestions in: vision signals (garments, palette, vibe), user profile, or user message.`;

  const outputSchema = `Output JSON only: { "state": "INTENT", "assistant": { "text": "…", "speak": true }, "ui": { "stepTitle": "…", "instruction": "…", "chips": ["…", "…"] } }`;

  try {
    const result = await complete(
      [
        { role: "system", content: `${systemPrompt}\n\n${outputSchema}` },
        { role: "user", content: userPrompt },
      ],
      { responseFormat: "json_object", maxTokens: 400 }
    );

    const state = result?.state && SESSION_STATES.includes(result.state) ? result.state : currentState;
    const assistant = {
      text: result?.assistant?.text && String(result.assistant.text).trim() ? String(result.assistant.text).trim() : "What would you like to try next?",
      speak: result?.assistant?.speak !== false,
    };
    const ui = {
      stepTitle: result?.ui?.stepTitle && String(result.ui.stepTitle).trim() ? String(result.ui.stepTitle).trim() : state.replace(/_/g, " "),
      instruction: result?.ui?.instruction && String(result.ui.instruction).trim() ? String(result.ui.instruction).trim() : "Tap Analyze or tell me what you'd like.",
      chips: Array.isArray(result?.ui?.chips) ? result.ui.chips.slice(0, 4).map((c) => String(c).trim()).filter(Boolean) : [],
    };

    return { state, assistant, ui };
  } catch (e) {
    console.warn("[liveStylingSessionAgent] getAssistantResponse LLM failed:", e?.message);
    const fallbackState = currentState === "DONE" ? "DONE" : currentState;
    return {
      state: fallbackState,
      assistant: { text: "Let's keep going — tap Analyze when you're ready, or tell me what you're thinking.", speak: true },
      ui: {
        stepTitle: fallbackState.replace(/_/g, " "),
        instruction: "Tap Analyze now or try another option.",
        chips: ["Analyze now", "Try another", "Next"],
      },
    };
  }
}

/**
 * Generate summary for "Save to Diary" (what works, next time). Used when saving session.
 * @param {string} userId
 * @param {object} session - session.outputs, session.messages, last vision signals if available
 * @param {object} visionSignals - optional last analysis signals
 * @returns {Promise<{ title: string, whatWorks: string[], nextTime: string[] }>}
 */
export async function getSessionSummary(userId, session, visionSignals = null) {
  const uid = normalizeId(userId);
  const [profile] = await Promise.all([uid ? getUserProfile(uid) : null]);
  const context = profile?.summary?.overall ? String(profile.summary.overall).slice(0, 300) : "";
  const signalsSummary =
    visionSignals && typeof visionSignals === "object"
      ? [
          Array.isArray(visionSignals.garments) && visionSignals.garments.length
            ? `Outfit: ${visionSignals.garments.map((g) => g.label || g.type).join(", ")}`
            : null,
          Array.isArray(visionSignals.palette) && visionSignals.palette.length ? `Colors: ${visionSignals.palette.join(", ")}` : null,
          Array.isArray(visionSignals.vibe) && visionSignals.vibe.length ? `Vibe: ${visionSignals.vibe.join(", ")}` : null,
        ]
        .filter(Boolean)
        .join(". ")
      : "";

  const prompt = [
    "Generate a brief style summary for a saved look from a live styling session.",
    context && `User context: ${context}`,
    signalsSummary && `From the session: ${signalsSummary}`,
    "Output JSON only: { \"title\": \"Short 2-4 word title\", \"whatWorks\": [\"2-4 short points\"], \"nextTime\": [\"1-2 gentle suggestions for next time\"] }.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await complete(
      [
        { role: "system", content: "You are a fashion advisor. Be encouraging and specific. Output valid JSON only." },
        { role: "user", content: prompt },
      ],
      { responseFormat: "json_object", maxTokens: 300 }
    );
    return {
      title: result?.title && String(result.title).trim() ? String(result.title).trim() : "Today's look",
      whatWorks: Array.isArray(result?.whatWorks) ? result.whatWorks.slice(0, 5).map((w) => String(w).trim()).filter(Boolean) : ["Your look is saved."],
      nextTime: Array.isArray(result?.nextTime) ? result.nextTime.slice(0, 3).map((n) => String(n).trim()).filter(Boolean) : [],
    };
  } catch (e) {
    console.warn("[liveStylingSessionAgent] getSessionSummary LLM failed:", e?.message);
    return {
      title: "Today's look",
      whatWorks: ["Your look is saved to your diary."],
      nextTime: [],
    };
  }
}
