/**
 * B9 Feed Agent
 * Analyzes current feed, suggests new content (text ideas or video URL ideas) and creates draft posts for admin approval.
 * Trigger: cron or POST /api/admin/feed-agent/run
 */

import { complete } from "../utils/llm.js";
import * as contentFeed from "../domain/contentFeed/contentFeed.js";

const MAX_SUGGESTIONS = 5;
const MAX_VIDEO_IDEAS = 10;
const DEFAULT_TYPES = ["drop", "curation", "brandStory", "newProduct", "newMicrostore"];
const VALIDATE_DIVERSITY_MAX_TOKENS = 200;

const VIDEO_URL_ALLOWED_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "vimeo.com",
  "www.vimeo.com",
  "tiktok.com",
  "www.tiktok.com",
  "instagram.com",
  "www.instagram.com",
];

function isValidVideoUrl(url) {
  if (!url || typeof url !== "string") return false;
  const u = url.trim();
  if (!u.startsWith("http://") && !u.startsWith("https://")) return false;
  try {
    const parsed = new URL(u);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return VIDEO_URL_ALLOWED_HOSTS.some((h) => h.replace(/^www\./, "") === host);
  } catch {
    return false;
  }
}

/**
 * Validate that suggested ideas are diverse and non-duplicative vs current feed.
 * @param {string} feedSummary - Summary of current feed (e.g. list of type: title)
 * @param {Array<{ title: string, type?: string }>} ideas - New ideas (title + optional type)
 * @returns {Promise<{ goodIndices: number[] } | null>} Indices of ideas to keep; null on failure (caller keeps all).
 */
async function validateFeedIdeasDiversity(feedSummary, ideas) {
  try {
    const list = (ideas || []).slice(0, MAX_SUGGESTIONS + 5).map((idea, i) => ({
      index: i,
      title: (idea.title || "").slice(0, 120),
      type: (idea.type || "").slice(0, 30),
    }));
    if (list.length === 0) return { goodIndices: [] };

    const prompt = `You are a quality checker for a fashion content feed.

Current feed (existing posts):
${(feedSummary || "(empty)").slice(0, 800)}

New post ideas (candidate titles):
${list.map((l) => `[${l.index}] ${l.type ? l.type + ": " : ""}${l.title}`).join("\n")}

Which of these new ideas are diverse and non-duplicative vs the current feed? (Keep ideas that add variety; drop ones that repeat themes or titles.)
Reply with JSON only: { "goodIndices": number[] } — 0-based indices of ideas to keep. Omit indices that are redundant or low quality. If all are good, include all indices.`;

    const out = await complete(
      [
        { role: "system", content: "You output only valid JSON. No markdown or preamble." },
        { role: "user", content: prompt },
      ],
      { responseFormat: "json_object", maxTokens: VALIDATE_DIVERSITY_MAX_TOKENS }
    );
    if (out && Array.isArray(out.goodIndices)) {
      const maxIdx = list.length - 1;
      const goodIndices = [...new Set(out.goodIndices)]
        .filter((i) => Number.isInteger(i) && i >= 0 && i <= maxIdx)
        .sort((a, b) => a - b);
      return { goodIndices };
    }
  } catch (e) {
    console.warn("[feedAgent] validateFeedIdeasDiversity failed:", e?.message);
  }
  return null;
}

/**
 * Run the Feed Agent: load approved feed, ask LLM for suggestions, create draft posts.
 * @param {{ seed?: string }} opts - optional seed (e.g. "streetwear", "runway")
 * @returns {{ created: number, suggestions: Array<{ title, subtitle, type }> }}
 */
export async function runFeedAgent(opts = {}) {
  const { seed = "" } = opts;
  const { items: currentPosts } = await contentFeed.listFeedPosts({
    active: true,
    approvalStatus: "approved",
    limit: 100,
  });

  const summary = currentPosts.length
    ? currentPosts
        .slice(0, 30)
        .map((p) => `- ${p.type}: ${p.title}`)
        .join("\n")
    : "(Feed is empty)";
  const typeCounts = {};
  currentPosts.forEach((p) => {
    typeCounts[p.type] = (typeCounts[p.type] || 0) + 1;
  });

  const prompt = `You are a fashion feed curator. Given the current feed content below, suggest new post ideas to enrich the feed (diversity, trending topics, video content, seasonal themes).
Current feed (${currentPosts.length} posts):
${summary}
${Object.keys(typeCounts).length ? `Types distribution: ${JSON.stringify(typeCounts)}` : ""}
${seed ? `Focus/seed: ${seed}` : ""}

Respond with a JSON object: { "suggestions": [ { "title": "string", "subtitle": "string (optional)", "type": "drop"|"curation"|"brandStory"|"newProduct"|"newMicrostore" } ] }
Suggest between 1 and ${MAX_SUGGESTIONS} ideas. Keep titles short and engaging. Do not duplicate existing titles.`;

  const messages = [{ role: "user", content: prompt }];
  const out = await complete(messages, { responseFormat: "json_object", maxTokens: 1500 });
  let suggestions = [];
  try {
    const parsed = typeof out === "string" ? JSON.parse(out) : out;
    const list = parsed?.suggestions;
    if (Array.isArray(list)) {
      suggestions = list
        .filter((s) => s && typeof s.title === "string" && s.title.trim())
        .slice(0, MAX_SUGGESTIONS)
        .map((s) => ({
          title: String(s.title).trim().slice(0, 500),
          subtitle: s.subtitle != null ? String(s.subtitle).trim().slice(0, 1000) : null,
          type: DEFAULT_TYPES.includes(s.type) ? s.type : "drop",
        }));
    }
  } catch (e) {
    console.warn("[feedAgent] LLM response parse failed:", e.message);
  }

  const validation = await validateFeedIdeasDiversity(summary, suggestions);
  if (validation && validation.goodIndices && validation.goodIndices.length >= 0) {
    suggestions = validation.goodIndices.map((i) => suggestions[i]).filter(Boolean);
  }

  const created = [];
  for (const s of suggestions) {
    try {
      const post = await contentFeed.createFeedPost({
        type: s.type,
        title: s.title,
        subtitle: s.subtitle ?? null,
        imageUrl: "",
        contentType: "image",
        createdBy: "feed_agent",
        createdByUserId: null,
        brandId: null,
        approvalStatus: "pending",
      });
      created.push({ id: post.id, title: post.title, type: post.type });
    } catch (err) {
      console.warn("[feedAgent] Failed to create draft:", err.message);
    }
  }

  return { created: created.length, suggestions, posts: created };
}

/**
 * Fetch video-idea URLs: ask LLM for short-form video URLs that are premium, fashion-related, good look and feel.
 * Creates draft feed posts (contentType: video) for each valid URL so admin can review and approve.
 * @param {{ seed?: string, maxVideoSuggestions?: number }} opts
 * @returns {{ created: number, ideas: Array<{ id, title, url }>, invalidUrls: string[] }}
 */
export async function runFeedAgentVideoIdeas(opts = {}) {
  const { seed = "", maxVideoSuggestions = MAX_VIDEO_IDEAS } = opts;
  const limit = Math.min(Math.max(1, Number(maxVideoSuggestions) || MAX_VIDEO_IDEAS), 15);

  const { items: currentPosts } = await contentFeed.listFeedPosts({
    active: true,
    approvalStatus: "approved",
    limit: 100,
  });
  const feedSummary = currentPosts.length
    ? currentPosts.slice(0, 30).map((p) => `- ${p.type}: ${p.title}`).join("\n")
    : "(Feed is empty)";

  const prompt = `You are a fashion feed curator. Suggest real, publicly available short-form video URLs for a premium fashion feed.

Requirements for each video:
1. Premium quality (high production value, not amateur)
2. About fashion: looks, style, fashion history, brands, runway, street style, or design
3. Good look and feel (aesthetic, on-brand for a fashion audience)

Allowed sources: YouTube (youtube.com, youtu.be), Vimeo (vimeo.com), TikTok (tiktok.com), Instagram (instagram.com).
Prefer short-form: YouTube Shorts, TikTok, Instagram Reels, or short Vimeo clips. Prefer actual watch URLs (e.g. https://www.youtube.com/shorts/... or https://vimeo.com/...).

${seed ? `Focus/theme: ${seed}` : ""}

Respond with a JSON object only:
{ "suggestions": [ { "title": "short engaging title", "subtitle": "optional one-line description", "url": "https://..." } ] }
Provide between 1 and ${limit} suggestions. Each url MUST be a full https URL from one of the allowed domains. Use real, working video URLs when you know them; otherwise use plausible example URLs from those domains.`;

  const messages = [{ role: "user", content: prompt }];
  const out = await complete(messages, { responseFormat: "json_object", maxTokens: 2000 });
  const invalidUrls = [];
  let rawSuggestions = [];
  try {
    const parsed = typeof out === "string" ? JSON.parse(out) : out;
    const list = parsed?.suggestions;
    if (Array.isArray(list)) {
      rawSuggestions = list
        .filter((s) => s && typeof s.title === "string" && s.title.trim() && s.url)
        .slice(0, limit)
        .map((s) => ({
          title: String(s.title).trim().slice(0, 500),
          subtitle: s.subtitle != null ? String(s.subtitle).trim().slice(0, 1000) : null,
          url: String(s.url).trim(),
        }));
    }
  } catch (e) {
    console.warn("[feedAgent] Video ideas parse failed:", e.message);
    return { created: 0, ideas: [], invalidUrls: [] };
  }

  let videoSuggestions = rawSuggestions;
  const validation = await validateFeedIdeasDiversity(
    feedSummary,
    rawSuggestions.map((s) => ({ title: s.title }))
  );
  if (validation && validation.goodIndices && validation.goodIndices.length >= 0) {
    videoSuggestions = validation.goodIndices.map((i) => rawSuggestions[i]).filter(Boolean);
  }

  const created = [];
  for (const s of videoSuggestions) {
    if (!isValidVideoUrl(s.url)) {
      invalidUrls.push(s.url);
      continue;
    }
    try {
      const post = await contentFeed.createFeedPost({
        type: "curation",
        title: s.title,
        subtitle: s.subtitle ?? null,
        imageUrl: "",
        videoUrl: s.url,
        contentType: "video",
        href: s.url,
        meta: JSON.stringify({ source: "feed_agent_video_idea" }),
        createdBy: "feed_agent",
        createdByUserId: null,
        brandId: null,
        approvalStatus: "pending",
      });
      created.push({ id: post.id, title: post.title, url: s.url });
    } catch (err) {
      console.warn("[feedAgent] Failed to create video draft:", err.message);
      invalidUrls.push(s.url);
    }
  }

  return {
    created: created.length,
    ideas: created,
    invalidUrls,
  };
}
