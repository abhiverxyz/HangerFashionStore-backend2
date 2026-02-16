/**
 * B1.3 Fashion Content Agent
 * Combines: (a) LLM view, (b) web sources (URLs from LLM, filtered by allowlist), (c) admin inputs.
 * Outputs trends (with strength, family/parent) and styling rules (with strength, optional parent).
 * Run on-demand or weekly via cron.
 */

import { complete } from "../utils/llm.js";
import { analyzeImage } from "../utils/imageAnalysis.js";
import { getPrisma } from "../core/db.js";
import {
  listFashionContentSources,
  markFashionContentSourcesProcessed,
  listAllowedFashionDomains,
  listTrends,
  upsertTrend,
  updateTrend,
  findTrendByTrendNameParentId,
  upsertStylingRule,
  findStylingRuleByBody,
  findStylingRuleByTitle,
  pruneTrendsToLimit,
  pruneStylingRulesToLimit,
} from "../domain/fashionContent/fashionContent.js";

const FETCH_TIMEOUT_MS = 15000;
const MAX_WEB_TEXT_PER_URL = 12000;
const MAX_COMBINED_CONTEXT = 80000;
const DEFAULT_MAX_TRENDS = 100;
const DEFAULT_MIN_TRENDS = 50;
const DEFAULT_MAX_RULES = 200;
const MAX_TOPUP_ROUNDS = 2;

function extractDomain(urlStr) {
  try {
    const u = new URL(urlStr);
    let host = u.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    return host;
  } catch {
    return null;
  }
}

function stripHtml(html) {
  if (typeof html !== "string") return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_WEB_TEXT_PER_URL);
}

async function fetchUrlText(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "HangerFashionAgent/1.0 (content aggregation)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return stripHtml(html);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Ask LLM for a list of fashion URLs to fetch. Returns array of URL strings.
 */
async function llmSuggestUrls() {
  const { listAllowedFashionDomains } = await import("../domain/fashionContent/fashionContent.js");
  const allowlist = await listAllowedFashionDomains();
  const domainList = allowlist.map((r) => r.domain).join(", ") || "none (add domains in admin)";
  const prompt = `You are a fashion research assistant. List 5-10 current, authoritative fashion or style article URLs (full URLs) that would help identify current trends and styling rules. Prefer well-known fashion publications. Return ONLY a JSON array of URL strings, e.g. ["https://example.com/article1", "https://example.com/article2"]. No other text.`;
  const messages = [
    {
      role: "user",
      content: `Allowed domains (only suggest URLs from these): ${domainList}\n\n${prompt}`,
    },
  ];
  const out = await complete(messages, { responseFormat: "json_object", maxTokens: 1000 });
  let list = [];
  if (Array.isArray(out)) list = out;
  else if (out && Array.isArray(out.urls)) list = out.urls;
  else if (out && Array.isArray(out.list)) list = out.list;
  return list.filter((u) => typeof u === "string" && u.startsWith("http"));
}

/**
 * Fetch URLs whose domain is in the allowlist. Returns array of { url, text }.
 */
async function fetchAllowedUrls(urls) {
  const allowlist = await listAllowedFashionDomains();
  const allowedSet = new Set(allowlist.map((r) => r.domain));
  const toFetch = urls.filter((u) => {
    const d = extractDomain(u);
    return d && allowedSet.has(d);
  });
  const results = [];
  for (const url of toFetch) {
    const text = await fetchUrlText(url);
    if (text) results.push({ url, text });
  }
  return results;
}

/**
 * Get pending admin sources and return text content. For images, use vision to extract trends/tips.
 */
async function gatherAdminSources(pendingSources) {
  const texts = [];
  const processedIds = [];
  for (const s of pendingSources) {
    if (s.type === "text") {
      texts.push(`[Admin text input]\n${s.payload}`);
      processedIds.push(s.id);
    } else if (s.type === "url") {
      const text = await fetchUrlText(s.payload);
      if (text) {
        texts.push(`[Admin URL: ${s.payload}]\n${text}`);
        processedIds.push(s.id);
      }
    } else if (s.type === "image") {
      try {
        const analysis = await analyzeImage(s.payload, {
          prompt: `Extract any fashion trends, style tips, or styling rules from this image. Return a JSON object with keys "trends" (array of short strings) and "stylingTips" (array of short strings).`,
          responseFormat: "json_object",
        });
        const part = [
          analysis.trends && analysis.trends.length ? `Trends: ${analysis.trends.join("; ")}` : "",
          analysis.stylingTips && analysis.stylingTips.length
            ? `Styling tips: ${analysis.stylingTips.join("; ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n");
        if (part) texts.push(`[Admin image]\n${part}`);
        processedIds.push(s.id);
      } catch {
        // skip failed image
      }
    }
  }
  return { texts, processedIds };
}

/**
 * Single LLM call: combined context -> structured trends and styling rules (with strength, hierarchy).
 */
async function llmGenerateStructured(combinedContext) {
  const system = `You are a fashion content analyst. Given context (admin input first, then LLM view and web articles), output a single JSON object with two keys:

"trends": array of objects. Output many trends (include both parent and child trends). Use familyName for hierarchy: child trends must have familyName set to the exact parent trend name.
Each trend: trendName (string), description (string, required — clear 1-2 sentence description), keywords (string, comma-separated), category (string, optional), strength (number 1-10), familyName (string, optional — if set, this trend is a child of a parent with this name; omit for root/parent trends), impactedItemTypes (string, optional — e.g. "knits, outerwear, trousers"), tellTaleSigns (string, optional — visual or style identifiers, tell-tale signs).
Example parent: { "trendName": "Quiet Luxury", "description": "Understated, high-quality aesthetics.", "keywords": "quiet luxury, minimal", "category": "Lifestyle", "strength": 8 }
Example child: { "trendName": "Minimal Knits", "description": "Simple knitwear with clean lines.", "keywords": "minimal, knits", "familyName": "Quiet Luxury", "strength": 7 }

"stylingRules": array of objects. Include a mix of root rules and child rules (use parentTitle to nest under an existing rule title).
Each rule: body (string), title (string, optional), ruleType (string, optional), category (string, optional), subject (string, optional), strength (number 1-10), parentTitle (string, optional — if set, this rule is a child of a rule with this title).
Example child rule: { "body": "Pair neutral knits with tailored trousers.", "title": "Quiet knit pairing", "parentTitle": "Color Harmony", "strength": 7 }

Admin-provided content is HIGH PRIORITY. When it conflicts with other sources, prefer admin input. Give admin-derived items slightly higher strength when reasonable.
If the admin input is clearly only a comment or note (e.g. "Remember to focus on winter" or "FYI"), do not create new trends or styling rules from it.
Ensure strength is between 1 and 10. Output only valid JSON.`;

  const userContent =
    combinedContext.length > MAX_COMBINED_CONTEXT
      ? combinedContext.slice(0, MAX_COMBINED_CONTEXT) + "\n\n[Content truncated.]"
      : combinedContext;

  const messages = [
    { role: "system", content: system },
    { role: "user", content: "Context:\n\n" + userContent },
  ];
  const out = await complete(messages, { responseFormat: "json_object", maxTokens: 4000 });
  return {
    trends: Array.isArray(out?.trends) ? out.trends : [],
    stylingRules: Array.isArray(out?.stylingRules) ? out.stylingRules : [],
  };
}

/**
 * Generate additional trends to reach a minimum total (top-up). Returns only new trends.
 */
async function llmGenerateMoreTrends(currentCount) {
  const minTrends = Number(process.env.MIN_TRENDS) || DEFAULT_MIN_TRENDS;
  const need = Math.max(1, minTrends - currentCount);
  const system = `You are a fashion content analyst. Output a JSON object with one key: "trends" (array of trend objects).
We currently have ${currentCount} trends; we need at least ${minTrends} total. Return ${Math.min(need + 5, 30)} new trends.
Each trend: trendName (string), description (string), keywords (string), category (string, optional), strength (number 1-10), familyName (string, optional — use for child trends), impactedItemTypes (string, optional), tellTaleSigns (string, optional).
Use familyName to nest child trends under parent trend names. Output only valid JSON.`;
  const messages = [
    { role: "system", content: system },
    { role: "user", content: "Generate only new trends (do not duplicate existing ones). Return JSON with key \"trends\"." },
  ];
  const out = await complete(messages, { responseFormat: "json_object", maxTokens: 3000 });
  return Array.isArray(out?.trends) ? out.trends : [];
}

function clampStrength(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Math.min(10, Math.max(1, Math.round(Number(n))));
}

const MIN_DESCRIPTION_LENGTH = 3;
const MIN_RULE_BODY_LENGTH = 5;

/**
 * Validate trends: require trendName and non-empty description; drop invalid.
 */
function validateTrends(trends) {
  const valid = [];
  for (const t of trends) {
    const name = (t.trendName && String(t.trendName).trim()) || "";
    const desc = (t.description && String(t.description).trim()) || "";
    if (name.length === 0 || desc.length < MIN_DESCRIPTION_LENGTH) continue;
    valid.push(t);
  }
  return { valid, dropped: (trends?.length || 0) - valid.length };
}

/**
 * Validate styling rules: require non-empty body; drop invalid.
 */
function validateRules(rules) {
  const valid = [];
  for (const r of rules) {
    const body = (r.body && String(r.body).trim()) || "";
    if (body.length < MIN_RULE_BODY_LENGTH) continue;
    valid.push(r);
  }
  return { valid, dropped: (rules?.length || 0) - valid.length };
}

/**
 * Reclub: ask LLM to group trends into families. Returns trends with familyName set (merged into existing where LLM provides mapping).
 */
async function llmReclubTrends(trends) {
  if (!trends || trends.length === 0) return trends;
  const list = trends.map((t) => ({
    trendName: t.trendName || "",
    description: (t.description || "").slice(0, 120),
    keywords: (t.keywords || "").slice(0, 80),
    category: t.category || "",
  }));
  const system = `You are a fashion analyst. Given a list of trends, group them into families (parent + children).
Return a JSON object with one key "families": array of { "parentName": string, "childNames": string[] }.
- parentName must be the exact trendName of one trend from the list (that trend becomes the parent).
- childNames: array of trendNames that belong under this parent (semantic similarity, e.g. "Minimal Knits" under "Quiet Luxury").
- A trend can be only a parent, only a child, or both (parent of one group, child of another).
- Prefer 3-8 families with 1-5 children each. Use exact trendName strings from the input.
Output only valid JSON.`;
  const messages = [
    { role: "system", content: system },
    { role: "user", content: `Trends:\n${JSON.stringify(list)}\n\nReturn families with parentName and childNames (use exact trendNames from above).` },
  ];
  const out = await complete(messages, { responseFormat: "json_object", maxTokens: 2000 });
  const families = Array.isArray(out?.families) ? out.families : [];
  const childToParent = new Map();
  for (const f of families) {
    const parent = f.parentName && String(f.parentName).trim();
    const children = Array.isArray(f.childNames) ? f.childNames : [];
    if (!parent) continue;
    for (const c of children) {
      const cn = c && String(c).trim();
      if (cn && cn.toLowerCase() !== parent.toLowerCase()) childToParent.set(cn.toLowerCase(), parent);
    }
  }
  return trends.map((t) => {
    const name = (t.trendName && String(t.trendName).trim()) || "";
    const key = name.toLowerCase();
    const assignedParent = childToParent.get(key);
    if (assignedParent && (!t.familyName || !String(t.familyName).trim())) {
      return { ...t, familyName: assignedParent };
    }
    return t;
  });
}

/**
 * Run the full agent: gather -> combine -> generate -> validate -> reclub -> write -> prune.
 */
export async function runFashionContentAgent(options = {}) {
  const seed = options.seed || ""; // e.g. "Spring 2025"
  const maxTrends = Number(process.env.MAX_TRENDS) || DEFAULT_MAX_TRENDS;
  const minTrends = Number(process.env.MIN_TRENDS) || DEFAULT_MIN_TRENDS;
  const maxRules = Number(process.env.MAX_RULES) || DEFAULT_MAX_RULES;
  const results = {
    trendsCreated: 0,
    trendsUpdated: 0,
    rulesCreated: 0,
    rulesUpdated: 0,
    trendsPruned: 0,
    rulesPruned: 0,
    droppedTrends: 0,
    droppedRules: 0,
    webUrlsFetched: [],
    errors: [],
  };

  // 1) Pending admin sources
  const { items: pendingSources } = await listFashionContentSources({ status: "pending" });
  const { texts: adminTexts, processedIds: adminProcessedIds } =
    await gatherAdminSources(pendingSources);

  // 2) LLM-suggested URLs — only URLs whose domain is in the allowlist are fetched; no other websites are read
  const suggestedUrls = await llmSuggestUrls();
  let webResults = await fetchAllowedUrls(suggestedUrls);
  // Fallback: if allowlist is set but no URLs were fetched, try curated fallback URLs from env (comma-separated; must be from allowlist domains)
  if (webResults.length === 0) {
    const allowlist = await listAllowedFashionDomains();
    if (allowlist.length > 0) {
      const fallbackEnv = process.env.FASHION_WEB_FALLBACK_URLS;
      if (fallbackEnv && typeof fallbackEnv === "string") {
        const fallbackUrls = fallbackEnv.split(",").map((u) => u.trim()).filter((u) => u.startsWith("http"));
        const fallbackResults = await fetchAllowedUrls(fallbackUrls);
        if (fallbackResults.length > 0) webResults = fallbackResults;
      }
    }
  }
  results.webUrlsFetched = webResults.map((r) => r.url);

  // 3) LLM "view" (optional short seed)
  const llmView =
    seed.trim() !== ""
      ? `Current focus: ${seed}. Consider recent fashion trends and styling rules.`
      : "Consider current fashion trends and styling rules (season-appropriate).";

  // 4) Combine context: admin input first with high priority so LLM weights it above other sources
  const adminBlock =
    adminTexts.length > 0
      ? "ADMIN INPUT (high priority — treat as trend, styling rule, or comment; when conflicting with other sources, prefer admin input):\n\n" +
        adminTexts.join("\n\n---\n\n")
      : "";
  const parts = [
    adminBlock,
    llmView,
    ...webResults.map((r) => `[Web: ${r.url}]\n${r.text}`),
  ].filter(Boolean);
  const combinedContext = parts.join("\n\n---\n\n");

  // 5) Generate structured output
  const { trends: rawTrends, stylingRules: rawRules } =
    await llmGenerateStructured(combinedContext);

  // 5b) Validate and reclub
  const { valid: validTrends, dropped: droppedT } = validateTrends(rawTrends);
  const { valid: validRules, dropped: droppedR } = validateRules(rawRules);
  results.droppedTrends = droppedT;
  results.droppedRules = droppedR;
  let trendsToWrite = validTrends;
  try {
    trendsToWrite = await llmReclubTrends(validTrends);
  } catch (e) {
    results.errors.push(`Reclub: ${e.message}`);
  }

  const familyKey = (name) => (name && String(name).trim()) ? String(name).trim().toLowerCase() : "";
  const familyDisplayName = {};
  for (const t of trendsToWrite) {
    const fn = t.familyName && String(t.familyName).trim();
    if (!fn) continue;
    const key = familyKey(fn);
    if (key && !familyDisplayName[key]) familyDisplayName[key] = fn;
  }
  const trendByName = new Map();
  for (const t of trendsToWrite) {
    const name = (t.trendName && String(t.trendName).trim()) || "";
    if (name) trendByName.set(familyKey(name), t);
  }

  // 6) Write trends: parents first (with real content when LLM provided same-name trend), then children; accurate created/updated counts
  const parentIdByFamily = {};
  for (const key of Object.keys(familyDisplayName)) {
    const displayName = familyDisplayName[key];
    const matchingTrend = trendByName.get(key);
    const parentPayload = {
      trendName: displayName,
      description: matchingTrend?.description && String(matchingTrend.description).trim().length >= MIN_DESCRIPTION_LENGTH
        ? matchingTrend.description
        : `Family: ${displayName}`,
      keywords: matchingTrend?.keywords ?? displayName,
      category: matchingTrend?.category ?? null,
      strength: matchingTrend?.strength != null ? clampStrength(matchingTrend.strength) : 8,
      source: "fashion_content_agent",
      impactedItemTypes: matchingTrend?.impactedItemTypes != null ? String(matchingTrend.impactedItemTypes) : null,
      tellTaleSigns: matchingTrend?.tellTaleSigns != null ? String(matchingTrend.tellTaleSigns) : null,
    };
    try {
      const existing = await findTrendByTrendNameParentId(displayName, null);
      if (existing) {
        await updateTrend(existing.id, parentPayload);
        parentIdByFamily[key] = existing.id;
        results.trendsUpdated++;
      } else {
        const parent = await upsertTrend(parentPayload);
        parentIdByFamily[key] = parent.id;
        results.trendsCreated++;
      }
    } catch (e) {
      const prisma = getPrisma();
      const p = await prisma.trend.findFirst({
        where: { trendName: displayName, parentId: null },
      });
      if (p) parentIdByFamily[key] = p.id;
      else results.errors.push(`Trend family ${displayName}: ${e.message}`);
    }
  }
  for (const t of trendsToWrite) {
    try {
      const trendName = t.trendName || "Unnamed";
      const fn = t.familyName && String(t.familyName).trim();
      const isSameAsParent = fn && familyKey(trendName) === familyKey(fn);
      const parentId = !fn || isSameAsParent ? null : (parentIdByFamily[familyKey(fn)] ?? null);
      const existing = await findTrendByTrendNameParentId(trendName, parentId);
      const payload = {
        trendName,
        description: t.description ?? null,
        keywords: t.keywords || trendName || "",
        category: t.category ?? null,
        strength: clampStrength(t.strength),
        parentId,
        source: "fashion_content_agent",
        impactedItemTypes: t.impactedItemTypes != null ? String(t.impactedItemTypes) : null,
        tellTaleSigns: t.tellTaleSigns != null ? String(t.tellTaleSigns) : null,
      };
      if (existing) {
        await updateTrend(existing.id, payload);
        results.trendsUpdated++;
      } else {
        await upsertTrend(payload);
        results.trendsCreated++;
      }
    } catch (e) {
      results.errors.push(`Trend ${t.trendName}: ${e.message}`);
    }
  }

  // 6b) Top-up: ensure at least MIN_TRENDS overall in the DB
  let topUpRound = 0;
  while (topUpRound < MAX_TOPUP_ROUNDS) {
    const { total: totalTrends } = await listTrends({ limit: 1 });
    if (totalTrends >= minTrends) break;
    const moreTrends = await llmGenerateMoreTrends(totalTrends);
    if (moreTrends.length === 0) break;
    const prisma = getPrisma();
    const rootTrends = await prisma.trend.findMany({
      where: { parentId: null },
      select: { id: true, trendName: true },
    });
    const familyKey = (name) => (name && String(name).trim()) ? String(name).trim().toLowerCase() : "";
    const parentIdByFamily = {};
    for (const r of rootTrends) parentIdByFamily[familyKey(r.trendName)] = r.id;
    for (const t of moreTrends) {
      const fn = t.familyName && String(t.familyName).trim();
      if (fn && !parentIdByFamily[familyKey(fn)]) {
        try {
          const existingParent = await findTrendByTrendNameParentId(fn, null);
          if (existingParent) {
            await updateTrend(existingParent.id, {
              trendName: fn,
              description: `Family: ${fn}`,
              keywords: fn,
              strength: 8,
              source: "fashion_content_agent",
            });
            parentIdByFamily[familyKey(fn)] = existingParent.id;
            results.trendsUpdated++;
          } else {
            const parent = await upsertTrend({
              trendName: fn,
              description: `Family: ${fn}`,
              keywords: fn,
              strength: 8,
              source: "fashion_content_agent",
            });
            parentIdByFamily[familyKey(fn)] = parent.id;
            results.trendsCreated++;
          }
        } catch (e) {
          const p = await prisma.trend.findFirst({ where: { trendName: fn, parentId: null } });
          if (p) parentIdByFamily[familyKey(fn)] = p.id;
        }
      }
    }
    for (const t of moreTrends) {
      try {
        const trendName = t.trendName || "Unnamed";
        const fn = t.familyName && String(t.familyName).trim();
        const isSameAsParent = fn && familyKey(trendName) === familyKey(fn);
        const parentId = !fn || isSameAsParent ? null : (parentIdByFamily[familyKey(fn)] ?? null);
        const existing = await findTrendByTrendNameParentId(trendName, parentId);
        const payload = {
          trendName,
          description: t.description ?? null,
          keywords: t.keywords || trendName || "",
          category: t.category ?? null,
          strength: clampStrength(t.strength),
          parentId,
          source: "fashion_content_agent",
          impactedItemTypes: t.impactedItemTypes != null ? String(t.impactedItemTypes) : null,
          tellTaleSigns: t.tellTaleSigns != null ? String(t.tellTaleSigns) : null,
        };
        if (existing) {
          await updateTrend(existing.id, payload);
          results.trendsUpdated++;
        } else {
          await upsertTrend(payload);
          results.trendsCreated++;
        }
      } catch (e) {
        results.errors.push(`Trend top-up ${t.trendName}: ${e.message}`);
      }
    }
    topUpRound++;
  }

  // 7) Write styling rules (validated only); check existing by body to update instead of duplicate
  for (const r of validRules) {
    if (!r.body || typeof r.body !== "string") continue;
    try {
      const existing = await findStylingRuleByBody(r.body);
      let parentId = null;
      if (r.parentTitle && String(r.parentTitle).trim()) {
        const parentRule = await findStylingRuleByTitle(String(r.parentTitle).trim());
        if (parentRule) parentId = parentRule.id;
      }
      if (existing) {
        await upsertStylingRule({
          id: existing.id,
          body: r.body,
          title: r.title ?? null,
          ruleType: r.ruleType ?? null,
          category: r.category ?? null,
          subject: r.subject ?? null,
          strength: clampStrength(r.strength),
          source: "fashion_content_agent",
          parentId,
        });
        results.rulesUpdated++;
      } else {
        await upsertStylingRule({
          body: r.body,
          title: r.title ?? null,
          ruleType: r.ruleType ?? null,
          category: r.category ?? null,
          subject: r.subject ?? null,
          strength: clampStrength(r.strength),
          source: "fashion_content_agent",
          parentId,
        });
        results.rulesCreated++;
      }
    } catch (e) {
      results.errors.push(`Rule: ${e.message}`);
    }
  }

  // 8) Prune to max limits only when over cap; never prune below MIN_TRENDS
  try {
    const { total: totalTrendsAfter } = await listTrends({ limit: 1 });
    const pruneLimit = Math.max(maxTrends, minTrends);
    if (totalTrendsAfter > pruneLimit) {
      const trendPrune = await pruneTrendsToLimit(pruneLimit);
      results.trendsPruned = trendPrune.deleted;
    }
  } catch (e) {
    results.errors.push(`Prune trends: ${e.message}`);
  }
  try {
    const rulePrune = await pruneStylingRulesToLimit(maxRules);
    results.rulesPruned = rulePrune.deleted;
  } catch (e) {
    results.errors.push(`Prune rules: ${e.message}`);
  }

  // 9) Mark admin sources as processed
  if (adminProcessedIds.length > 0) await markFashionContentSourcesProcessed(adminProcessedIds);

  return results;
}
