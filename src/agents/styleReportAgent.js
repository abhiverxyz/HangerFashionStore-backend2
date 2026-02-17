/**
 * B4.3 Style Report Agent
 * Loads last N looks (min/max from settings), builds detailed by-looks (with itemsByType/pairing) and by-items
 * (aggregates + detailedBreakdown), generates style profile and report via LLM, persists standard-format report data.
 *
 * @typedef {Object} ItemSummary
 * @property {string|null} [type] - e.g. "clothing", "footwear", "accessory"
 * @property {string|null} [description]
 * @property {string|null} [category]
 * @property {string|null} [color]
 * @property {string|null} [style]
 * @property {string|null} [lookId] - optional, for linking back to look
 *
 * @typedef {Object} StyleReportLook
 * @property {string} lookId
 * @property {string|null} imageUrl
 * @property {string|null} [vibe]
 * @property {string|null} [occasion]
 * @property {string|null} [timeOfDay]
 * @property {string|null} [comment]
 * @property {string[]} [labels]
 * @property {ItemSummary[]} [itemsSummary]
 * @property {{ clothing: ItemSummary[], footwear: ItemSummary[], accessory: ItemSummary[] }} itemsByType
 * @property {string|null} [pairingSummary]
 * @property {string[]} [classificationTags]
 * @property {string|null} [analysisComment]
 * @property {string[]} [suggestions]
 *
 * @typedef {Object} StyleReportByItems
 * @property {{ itemCount: number, byCategory: Object<string,number>, byColor: Object<string,number>, byType: Object<string,number>, topTypes: { name: string, count: number }[] }} aggregates
 * @property {{ byCategory: Object<string,ItemSummary[]>, byColor: Object<string,ItemSummary[]>, byType: Object<string,ItemSummary[]> }} detailedBreakdown
 *
 * @typedef {Object} SubElementValue
 * @property {*} value
 * @property {string[]} [scale]
 * @property {number} [position]
 * @property {*} [options]
 * @property {number} [confidence]
 *
 * @typedef {Object} StyleElement
 * @property {string} label
 * @property {Object<string, SubElementValue>} sub_elements
 *
 * @typedef {Object} Synthesis
 * @property {string|null} [style_descriptor_short]
 * @property {string|null} [style_descriptor_long]
 * @property {string[]} [style_keywords]
 * @property {string|null} [one_line_takeaway]
 * @property {string[]} [dominant_categories]
 * @property {string[]} [dominant_colors]
 * @property {string[]} [dominant_silhouettes]
 *
 * @typedef {Object} StyleDna
 * @property {string|null} [archetype_name]
 * @property {string|null} [archetype_tagline]
 * @property {string[]} [keywords]
 * @property {string|null} [dna_line]
 *
 * @typedef {Object} IdeasForYou
 * @property {string[]} [within_style_zone]
 * @property {string[]} [adjacent_style_zone]
 *
 * @typedef {Object} ComprehensiveProfile
 * @property {Object<string, StyleElement>} [elements]
 * @property {Synthesis} [synthesis]
 * @property {StyleDna} [style_dna]
 * @property {IdeasForYou} [ideas_for_you]
 * @property {{ version?: string, generated_at?: string, generated_from_looks?: number }} [meta]
 *
 * @typedef {Object} StyleReportData
 * @property {number} version
 * @property {string} generatedAt - ISO 8601
 * @property {string} headline
 * @property {{ title: string, content: string }[]} sections
 * @property {StyleReportLook[]} byLooks
 * @property {StyleReportByItems} byItems
 * @property {ComprehensiveProfile} [comprehensive]
 *
 * @typedef {Object} StyleProfileData
 * @property {string|null} [dominantSilhouettes]
 * @property {string|null} [colorPalette]
 * @property {string|null} [formalityRange]
 * @property {string[]} [styleKeywords]
 * @property {string|null} [oneLiner]
 * @property {string|null} [pairingTendencies]
 * @property {ComprehensiveProfile} [comprehensive]
 */

import { complete } from "../utils/llm.js";
import { normalizeId } from "../core/helpers.js";
import { listLooksForStyleReport } from "../domain/looks/look.js";
import { getUserProfile, writeStyleProfile, saveLatestStyleReport } from "../domain/userProfile/userProfile.js";
import { getStyleReportSettings } from "../config/styleReportSettings.js";

const STYLE_REPORT_MAX_TOKENS = 2000;
const COMPREHENSIVE_MAX_TOKENS = 2500;
const REPORT_DATA_VERSION = 1;

/** Nine dimension keys for comprehensive profile (backend parity). */
const COMPREHENSIVE_ELEMENT_KEYS = [
  "colour_palette",
  "silhouette_and_fit",
  "fabric_texture_and_feel",
  "styling_strategy",
  "trend_preference",
  "construction_and_detail_sensitivity",
  "expression_intensity",
  "contextual_flexibility",
  "temporal_orientation",
];

/**
 * Normalize one item from itemsSummary to ItemSummary shape: { type, description?, category?, color?, style?, lookId? }
 */
function toItemSummary(it, lookId = null) {
  const item = {
    type: it?.type ?? null,
    description: it?.description ?? null,
    category: it?.category ?? it?.category_lvl1 ?? null,
    color: it?.color ?? it?.color_primary ?? null,
    style: it?.style ?? it?.style_family ?? null,
  };
  if (lookId) item.lookId = lookId;
  return item;
}

/**
 * Build by-looks: each look has itemsByType { clothing, footwear, accessory } and optional pairingSummary.
 */
function buildByLooks(items) {
  return items.map((look) => {
    const p = look.lookDataParsed || {};
    const itemsSummary = Array.isArray(p.itemsSummary) ? p.itemsSummary : [];
    const clothing = [];
    const footwear = [];
    const accessory = [];
    for (const it of itemsSummary) {
      const t = (it?.type || "").toLowerCase();
      const summary = toItemSummary(it, look.id);
      if (t === "footwear") footwear.push(summary);
      else if (t === "accessory") accessory.push(summary);
      else clothing.push(summary);
    }
    const itemsByType = { clothing, footwear, accessory };
    const parts = [];
    if (clothing.length) parts.push(clothing.map((i) => i.description || i.category || "clothing").slice(0, 3).join(", "));
    if (footwear.length) parts.push(footwear.map((i) => i.description || i.category || "footwear").slice(0, 2).join(", "));
    if (accessory.length) parts.push(accessory.map((i) => i.description || i.category || "accessory").slice(0, 2).join(", "));
    const pairingSummary = parts.length ? parts.join(" with ") : null;

    return {
      lookId: look.id,
      imageUrl: look.imageUrl ?? null,
      vibe: look.vibe ?? p.vibe ?? null,
      occasion: look.occasion ?? p.occasion ?? null,
      timeOfDay: p.timeOfDay ?? null,
      comment: p.comment ?? null,
      labels: Array.isArray(p.labels) ? p.labels : [],
      itemsSummary,
      itemsByType,
      pairingSummary,
      classificationTags: Array.isArray(p.classificationTags) ? p.classificationTags : [],
      analysisComment: p.analysisComment ?? null,
      suggestions: Array.isArray(p.suggestions) ? p.suggestions : [],
    };
  });
}

/**
 * Build by-items: aggregates (counts) + detailedBreakdown (items by category, color, type).
 */
function buildByItems(byLooks) {
  const allItems = [];
  for (const look of byLooks) {
    for (const it of look.itemsSummary || []) {
      allItems.push({
        ...toItemSummary(it, look.lookId),
      });
    }
  }

  const byCategoryCount = {};
  const byColorCount = {};
  const byTypeCount = {};
  const byCategoryItems = {};
  const byColorItems = {};
  const byTypeItems = {};

  for (const it of allItems) {
    const cat = it.category || "other";
    byCategoryCount[cat] = (byCategoryCount[cat] || 0) + 1;
    if (!byCategoryItems[cat]) byCategoryItems[cat] = [];
    byCategoryItems[cat].push(it);

    const col = it.color || "other";
    byColorCount[col] = (byColorCount[col] || 0) + 1;
    if (!byColorItems[col]) byColorItems[col] = [];
    byColorItems[col].push(it);

    const typ = it.type || "other";
    byTypeCount[typ] = (byTypeCount[typ] || 0) + 1;
    if (!byTypeItems[typ]) byTypeItems[typ] = [];
    byTypeItems[typ].push(it);
  }

  const topTypes = Object.entries(byTypeCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  return {
    aggregates: {
      itemCount: allItems.length,
      byCategory: byCategoryCount,
      byColor: byColorCount,
      byType: byTypeCount,
      topTypes,
    },
    detailedBreakdown: {
      byCategory: byCategoryItems,
      byColor: byColorItems,
      byType: byTypeItems,
    },
  };
}

/**
 * Normalize LLM comprehensive response into canonical ComprehensiveProfile shape.
 * @param {*} raw - Raw LLM response (may be partial or malformed)
 * @returns {ComprehensiveProfile|null} Normalized comprehensive or null if invalid
 */
function normalizeComprehensive(raw) {
  if (!raw || typeof raw !== "object") return null;
  const result = {};
  if (raw.elements && typeof raw.elements === "object") {
    result.elements = {};
    for (const key of COMPREHENSIVE_ELEMENT_KEYS) {
      const el = raw.elements[key];
      if (el && typeof el === "object") {
        result.elements[key] = {
          label: typeof el.label === "string" ? el.label : key.replace(/_/g, " "),
          sub_elements: typeof el.sub_elements === "object" && el.sub_elements !== null ? el.sub_elements : {},
        };
      }
    }
  }
  if (raw.synthesis && typeof raw.synthesis === "object") {
    result.synthesis = {
      style_descriptor_short: raw.synthesis.style_descriptor_short ?? null,
      style_descriptor_long: raw.synthesis.style_descriptor_long ?? null,
      style_keywords: Array.isArray(raw.synthesis.style_keywords) ? raw.synthesis.style_keywords : [],
      one_line_takeaway: raw.synthesis.one_line_takeaway ?? null,
      dominant_categories: Array.isArray(raw.synthesis.dominant_categories) ? raw.synthesis.dominant_categories : [],
      dominant_colors: Array.isArray(raw.synthesis.dominant_colors) ? raw.synthesis.dominant_colors : [],
      dominant_silhouettes: Array.isArray(raw.synthesis.dominant_silhouettes) ? raw.synthesis.dominant_silhouettes : [],
    };
  }
  if (raw.style_dna && typeof raw.style_dna === "object") {
    result.style_dna = {
      archetype_name: raw.style_dna.archetype_name ?? null,
      archetype_tagline: raw.style_dna.archetype_tagline ?? null,
      keywords: Array.isArray(raw.style_dna.keywords) ? raw.style_dna.keywords : [],
      dna_line: raw.style_dna.dna_line ?? null,
    };
  }
  if (raw.ideas_for_you && typeof raw.ideas_for_you === "object") {
    result.ideas_for_you = {
      within_style_zone: Array.isArray(raw.ideas_for_you.within_style_zone) ? raw.ideas_for_you.within_style_zone : [],
      adjacent_style_zone: Array.isArray(raw.ideas_for_you.adjacent_style_zone) ? raw.ideas_for_you.adjacent_style_zone : [],
    };
  }
  if (Object.keys(result).length === 0) return null;
  return result;
}

/**
 * Build flat style profile fields from comprehensive (synthesis + style_dna).
 * @param {ComprehensiveProfile} comp
 * @param {Object} existingFlat - Existing flat profile from first LLM
 */
function flatFromComprehensive(comp, existingFlat = {}) {
  const flat = { ...existingFlat };
  if (comp.synthesis) {
    const s = comp.synthesis;
    if (Array.isArray(s.dominant_silhouettes) && s.dominant_silhouettes.length > 0) {
      flat.dominantSilhouettes = s.dominant_silhouettes.join(", ");
    } else if (s.style_descriptor_short) {
      flat.dominantSilhouettes = flat.dominantSilhouettes ?? s.style_descriptor_short;
    }
    if (Array.isArray(s.dominant_colors) && s.dominant_colors.length > 0) {
      flat.colorPalette = s.dominant_colors.join(", ");
    }
    if (s.one_line_takeaway) flat.oneLiner = flat.oneLiner ?? s.one_line_takeaway;
    if (Array.isArray(s.style_keywords) && s.style_keywords.length > 0) {
      flat.styleKeywords = flat.styleKeywords?.length ? flat.styleKeywords : s.style_keywords;
    }
  }
  if (comp.style_dna && Array.isArray(comp.style_dna.keywords) && comp.style_dna.keywords.length > 0 && !(flat.styleKeywords?.length)) {
    flat.styleKeywords = comp.style_dna.keywords;
  }
  return flat;
}

/**
 * Run Style Report Agent.
 * @param {Object} input - { userId: string, forceRegenerate?: boolean }
 * @returns {Promise<{ reportData: StyleReportData | null, styleProfileUpdated: boolean, notEnoughLooks?: boolean, message?: string }>}
 */
export async function run(input) {
  const userId = input?.userId;
  const uid = normalizeId(userId);
  if (!uid) throw new Error("userId required");

  const { minLooks, maxLooks } = await getStyleReportSettings();
  const { items: looks, total } = await listLooksForStyleReport(uid, maxLooks);
  if (looks.length < minLooks) {
    return {
      reportData: null,
      styleProfileUpdated: false,
      notEnoughLooks: true,
      message: `Add at least ${minLooks} look(s) (upload and analyze outfit images) to generate your style report.`,
    };
  }

  const byLooks = buildByLooks(looks);
  const byItems = buildByItems(byLooks);

  const existingProfile = await getUserProfile(uid);
  const existingStyleData = existingProfile?.styleProfile?.data ?? null;
  const existingSnippet =
    existingStyleData != null ? JSON.stringify(existingStyleData).slice(0, 800) : "None yet.";

  const byLooksSnippet = JSON.stringify(
    byLooks.map((l) => ({
      vibe: l.vibe,
      occasion: l.occasion,
      timeOfDay: l.timeOfDay,
      labels: l.labels,
      classificationTags: l.classificationTags,
      pairingSummary: l.pairingSummary,
      itemCountByType: {
        clothing: (l.itemsByType?.clothing || []).length,
        footwear: (l.itemsByType?.footwear || []).length,
        accessory: (l.itemsByType?.accessory || []).length,
      },
    })),
    null,
    0
  ).slice(0, 3000);
  const byItemsSnippet = JSON.stringify(byItems.aggregates, null, 0).slice(0, 2000);

  const generatedAt = new Date().toISOString();
  let styleProfileData = {};
  let headline = "Your Style Report";
  let sections = [];

  try {
    const prompt = `You are a fashion style analyst. Based on the user's recent looks and item aggregates, produce:
1) A style profile (for personalization): dominant silhouettes, color palette, formality range, style keywords, one-liner summary. Optionally "pairingTendencies": one sentence on how they pair clothing with footwear/accessories.
2) A short report: headline and 2-4 sections (e.g. "Summary", "Look patterns", "Item patterns", "Recommendations") with title and content (1-3 sentences or bullets).

Data:
By-looks (with pairing per look): ${byLooksSnippet}
By-items (aggregate counts): ${byItemsSnippet}
Existing style profile (if any): ${existingSnippet}

Respond with a single JSON object with exactly two keys:
- "styleProfile": object with keys: dominantSilhouettes (string), colorPalette (string), formalityRange (string), styleKeywords (array of strings), oneLiner (string), pairingTendencies (string or null). Use null or empty array where not inferrable.
- "report": object with keys: headline (string), sections (array of { title: string, content: string }).`;

    const out = await complete(
      [
        { role: "system", content: "You output only valid JSON. No markdown or preamble." },
        { role: "user", content: prompt },
      ],
      { responseFormat: "json_object", maxTokens: STYLE_REPORT_MAX_TOKENS, temperature: 0.3 }
    );

    if (out && typeof out === "object") {
      if (out.styleProfile && typeof out.styleProfile === "object") {
        styleProfileData = out.styleProfile;
      }
      if (out.report && typeof out.report === "object") {
        if (out.report.headline) headline = out.report.headline;
        if (Array.isArray(out.report.sections) && out.report.sections.length > 0) {
          sections = out.report.sections.map((s) => ({
            title: s.title || "Section",
            content: s.content || "",
          }));
        }
      }
    }
  } catch (err) {
    console.warn("[styleReportAgent] LLM step failed, using minimal report:", err?.message);
  }

  let comprehensive = null;
  try {
    const comprehensivePrompt = `You are a fashion style analyst. Based on the user's recent looks and item aggregates below, produce a structured "comprehensive" style profile in the same shape as a style system that uses dimensions and synthesis.

Data:
By-looks (vibes, occasions, pairing per look): ${byLooksSnippet}
By-items (aggregate counts): ${byItemsSnippet}

Respond with a single JSON object with up to four keys (you may omit "elements" if too large; at least return synthesis and style_dna):
- "elements": optional object. Keys can be any of: colour_palette, silhouette_and_fit, fabric_texture_and_feel, styling_strategy, trend_preference, construction_and_detail_sensitivity, expression_intensity, contextual_flexibility, temporal_orientation. Each value: { "label": "Human title", "sub_elements": { "key_name": { "value": "..." or [], "scale": ["low","medium","high"] optional } } }. Keep each dimension to 1-3 sub_elements max.
- "synthesis": { "style_descriptor_short": string, "style_descriptor_long": string optional, "style_keywords": string[], "one_line_takeaway": string, "dominant_categories": string[], "dominant_colors": string[], "dominant_silhouettes": string[] }.
- "style_dna": { "archetype_name": string, "archetype_tagline": string optional, "keywords": string[], "dna_line": string }.
- "ideas_for_you": { "within_style_zone": string[], "adjacent_style_zone": string[] } optional.

Output only valid JSON. No markdown or preamble.`;

    const compOut = await complete(
      [
        { role: "system", content: "You output only valid JSON. No markdown or preamble." },
        { role: "user", content: comprehensivePrompt },
      ],
      { responseFormat: "json_object", maxTokens: COMPREHENSIVE_MAX_TOKENS, temperature: 0.3 }
    );
    comprehensive = normalizeComprehensive(compOut);
  } catch (err) {
    console.warn("[styleReportAgent] Comprehensive LLM step failed, storing report without comprehensive:", err?.message);
  }

  const reportData = {
    version: REPORT_DATA_VERSION,
    generatedAt,
    headline,
    sections,
    byLooks: byLooks.map((l) => ({
      lookId: l.lookId,
      imageUrl: l.imageUrl,
      vibe: l.vibe,
      occasion: l.occasion,
      timeOfDay: l.timeOfDay,
      comment: l.comment,
      labels: l.labels,
      classificationTags: l.classificationTags,
      analysisComment: l.analysisComment,
      suggestions: l.suggestions,
      itemsByType: l.itemsByType,
      pairingSummary: l.pairingSummary,
    })),
    byItems: {
      aggregates: byItems.aggregates,
      detailedBreakdown: byItems.detailedBreakdown,
    },
  };
  let finalStyleProfileData = styleProfileData;
  if (comprehensive) {
    const comprehensiveWithMeta = {
      ...comprehensive,
      meta: {
        ...(comprehensive.meta || {}),
        version: "1",
        generated_at: generatedAt,
        generated_from_looks: byLooks.length,
      },
    };
    reportData.comprehensive = comprehensiveWithMeta;
    finalStyleProfileData = flatFromComprehensive(comprehensive, styleProfileData);
    finalStyleProfileData.comprehensive = comprehensiveWithMeta;
  }

  await writeStyleProfile(uid, {
    source: "style_report_agent",
    data: finalStyleProfileData,
  });
  await saveLatestStyleReport(uid, reportData);

  return {
    reportData,
    styleProfileUpdated: true,
  };
}
