/**
 * Personal Insight Agent
 * Produces a 2–3 line, 15–20 word insight for the Looks page personal banner from:
 * (a) latest looks (b) style report (c) recent user history (d) user profile.
 * Validates word count and optionally coherence; writes to UserProfile.personalInsight.
 */

import { getUserProfile, getLatestStyleReport, writePersonalInsight } from "../domain/userProfile/userProfile.js";
import * as lookDomain from "../domain/looks/look.js";
import { complete } from "../utils/llm.js";
import { normalizeId } from "../core/helpers.js";

const MIN_WORDS = 15;
const MAX_WORDS = 20;
const CONTEXT_MAX_CHARS = 800;
const FALLBACK_INSIGHT = "Your style profile is taking shape.";
const INSIGHT_THROTTLE_MS = 60 * 60 * 1000; // 1 hour

function wordCount(text) {
  if (!text || typeof text !== "string") return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function inWordRange(text) {
  const n = wordCount(text);
  return n >= MIN_WORDS && n <= MAX_WORDS;
}

/**
 * Build context string for the LLM from profile, latest looks, and style report.
 */
function buildContext(profile, looksResult, styleReportResult) {
  const parts = [];

  if (looksResult && looksResult.items && looksResult.items.length > 0) {
    const items = looksResult.items.slice(0, 5);
    const snippets = items.map((look) => {
      let comment = look.vibe || look.occasion || "";
      try {
        const data = typeof look.lookData === "string" ? JSON.parse(look.lookData) : look.lookData || {};
        comment = data.comment || data.vibe || data.occasion || comment;
      } catch {
        // use vibe/occasion above
      }
      return comment;
    }).filter(Boolean);
    parts.push(`Latest looks (${looksResult.total} total). Recent: ${snippets.slice(0, 2).join("; ") || "—"}`);
  } else {
    parts.push("Latest looks: none yet.");
  }

  if (styleReportResult && styleReportResult.reportData) {
    const headline = styleReportResult.reportData.headline;
    parts.push(`Style report: ${headline || "Available."}`);
  } else {
    parts.push("Style report: not generated yet.");
  }

  const historySummary = profile?.history?.summary;
  if (historySummary != null && typeof historySummary === "string" && historySummary.trim()) {
    parts.push(`Recent history: ${String(historySummary).trim().slice(0, 200)}`);
  } else if (Array.isArray(profile?.history?.recentEvents) && profile.history.recentEvents.length > 0) {
    const n = profile.history.recentEvents.length;
    parts.push(`Recent history: ${n} events in last 90 days.`);
  } else {
    parts.push("Recent history: no recent activity.");
  }

  const sections = profile?.summary?.sections;
  if (sections) {
    const styleProfile = sections.styleProfile || "";
    const fashionNeed = sections.fashionNeed || "";
    const fashionMotivation = sections.fashionMotivation || "";
    if (styleProfile || fashionNeed || fashionMotivation) {
      parts.push(`Profile: style ${styleProfile.slice(0, 120)}; need ${fashionNeed.slice(0, 100)}; motivation ${fashionMotivation.slice(0, 100)}`);
    }
  }

  const context = parts.join("\n");
  return context.length > CONTEXT_MAX_CHARS ? context.slice(0, CONTEXT_MAX_CHARS) + "…" : context;
}

/**
 * Run Personal Insight Agent: generate 15–20 word insight, validate, write and return.
 * @param {{ userId: string }} input
 * @returns {Promise<{ insight: string, source?: string }>}
 */
export async function run(input) {
  const userId = input?.userId;
  const uid = normalizeId(userId);
  if (!uid) throw new Error("userId required");

  const [profile, looksResult, styleReportResult] = await Promise.all([
    getUserProfile(uid),
    lookDomain.listLooks({ userId: uid, limit: 5, offset: 0 }),
    getLatestStyleReport(uid),
  ]);

  if (!profile) throw new Error("User profile not found");

  const context = buildContext(profile, looksResult, styleReportResult);

  let insight = FALLBACK_INSIGHT;
  let source = null;

  try {
    const result = await complete(
      [
        {
          role: "system",
          content: `You are a fashion insight writer. Given a user's latest looks, style report, recent history, and profile, write ONE short personal insight for the Looks page banner.
Rules: Exactly 2-3 lines. Between 15 and 20 words total. User-centric, positive, and about their style or fashion journey. No generic fluff.
Output JSON only: { "insight": "your insight text here", "source": "latest_looks" | "style_report" | "recent_history" | "user_profile" }.
Pick the source that best reflects the insight.`,
        },
        { role: "user", content: context },
      ],
      { responseFormat: "json_object", maxTokens: 150 }
    );

    if (result && typeof result.insight === "string" && result.insight.trim()) {
      const raw = result.insight.trim();
      if (inWordRange(raw)) {
        insight = raw;
        source = result.source || null;
      } else {
        const w = wordCount(raw);
        if (w > MAX_WORDS) {
          const shortened = raw.split(/\s+/).slice(0, MAX_WORDS).join(" ");
          if (wordCount(shortened) >= MIN_WORDS) insight = shortened;
        }
      }
    }
  } catch (e) {
    console.warn("[personalInsightAgent] LLM failed:", e?.message);
  }

  if (!inWordRange(insight)) {
    insight = FALLBACK_INSIGHT;
    source = null;
  }

  if (inWordRange(insight) && insight !== FALLBACK_INSIGHT) {
    try {
      await writePersonalInsight(uid, { insight });
    } catch (e) {
      console.warn("[personalInsightAgent] writePersonalInsight failed:", e?.message);
    }
  }

  return { insight, source };
}

/**
 * Check if personal insight is missing or older than throttle (e.g. 1 hour).
 */
export function shouldRefreshInsight(profile) {
  if (!profile) return true;
  const updated = profile.personalInsightUpdatedAt ? new Date(profile.personalInsightUpdatedAt).getTime() : 0;
  if (!profile.personalInsight || !profile.personalInsight.trim()) return true;
  return Date.now() - updated > INSIGHT_THROTTLE_MS;
}
