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
import {
  paletteRange,
  contrastLevel,
  weightedSaturation,
  resolveColor,
  normalizeColorForPalette,
  getCanonicalColorNames,
} from "../utils/colorUtils.js";
import { listLooksForStyleReport } from "../domain/looks/look.js";
import { getUserProfile, writeStyleProfile, saveLatestStyleReport } from "../domain/userProfile/userProfile.js";
import { getStyleReportSettings, STYLE_REPORT_CARD_TYPES } from "../config/styleReportSettings.js";
import {
  buildLookFingerprint,
  buildSettingsFingerprint,
  buildStyleReportInputFingerprint,
} from "../utils/styleReportFingerprint.js";
import { composeLook } from "../domain/lookComposition/lookComposition.js";
import { buildUserContextFromProfile } from "../domain/userProfile/contextForAgents.js";
import {
  getOneGeneratedImage,
  createGeneratedImage,
  SOURCE_LOOK,
} from "../domain/generatedImage.js";

const STYLE_REPORT_MAX_TOKENS = 2000;
const COMPREHENSIVE_MAX_TOKENS = 2500;
const STYLE_PROFILE_MAX_TOKENS = 3500;
const CARD_GENERATION_MAX_TOKENS = 600;
const REPORT_DATA_VERSION = 1;
const REPORT_DATA_VERSION_CARDS = 2;

/** Fallback tone when settings do not provide one (should not happen if config defaults are used). */
const FALLBACK_TONE =
  "Be insightful, concise, and use natural language with no filler. Sound relatable, warm, and lightly humorous. Content should feel real and personally relevant to the user.";

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
 * Normalize one item from itemsSummary to ItemSummary shape: { type, description?, category?, color?, color_hex?, color_brightness?, color_saturation?, color_is_neutral?, style?, lookId? }
 */
function toItemSummary(it, lookId = null) {
  const item = {
    type: it?.type ?? null,
    description: it?.description ?? null,
    category: it?.category ?? it?.category_lvl1 ?? null,
    color: it?.color ?? it?.color_primary ?? null,
    color_hex: it?.color_hex ?? it?.colorHex ?? null,
    color_brightness: it?.color_brightness ?? it?.colorBrightness ?? null,
    color_saturation: it?.color_saturation ?? it?.colorSaturation ?? null,
    color_saturation_percent: it?.color_saturation_percent ?? it?.colorSaturationPercent ?? null,
    color_lightness_percent: it?.color_lightness_percent ?? it?.colorLightnessPercent ?? null,
    color_is_neutral: it?.color_is_neutral === true || it?.colorIsNeutral === true,
    style: it?.style ?? it?.style_family ?? null,
  };
  if (lookId) item.lookId = lookId;
  return item;
}

/**
 * Build colour list for palette/weightedSaturation/Style Code. Resolves name→hex when hex missing so every item contributes with correct saturation from canonical hex.
 * @param {StyleReportLook[]} byLooks
 * @returns {Array<{ hex: string, weight: number, isNeutral: boolean }>}
 */
function buildAllItemsForColor(byLooks) {
  const out = [];
  for (const look of byLooks) {
    for (const it of look.itemsSummary || []) {
      const sum = toItemSummary(it, look.lookId);
      let hex = sum.color_hex;
      let isNeutral = sum.color_is_neutral === true;
      if (!hex && (sum.color || sum.color_primary)) {
        const resolved = resolveColor(sum.color || sum.color_primary);
        if (resolved) {
          hex = resolved.hex;
          isNeutral = resolved.isNeutral;
        }
      }
      if (hex) {
        out.push({ hex, weight: 1, isNeutral });
      }
    }
  }
  return out;
}

/** Map comprehensive sub_element scale to 0-10. low→2, medium→5, high→8. position 0-1 or 0-10 used if present. */
function scaleToScore(subEl) {
  if (!subEl || typeof subEl !== "object") return null;
  if (typeof subEl.position === "number") {
    if (subEl.position <= 1) return Math.round(subEl.position * 10);
    if (subEl.position <= 10) return Math.round(subEl.position);
  }
  const scale = Array.isArray(subEl.scale) ? subEl.scale[0] : subEl.scale;
  if (typeof scale !== "string") return null;
  const s = String(scale).toLowerCase();
  if (s === "low") return 2;
  if (s === "medium") return 5;
  if (s === "high") return 8;
  return null;
}

/** Fit keywords: relaxed/comfort/loose/oversized/soft → low (0-3); tailored/fitted/structured/slim/sharp → high (7-10). */
const FIT_LOW_KEYWORDS = /\b(relaxed|comfort|loose|oversized|soft|easy|casual)\b/i;
const FIT_HIGH_KEYWORDS = /\b(tailored|fitted|structured|slim|sharp|defined|tailoring)\b/i;

/** Structure slider (structured vs fluid): fluid = soft/drapey/flowing → low; structured = sharp/tailored → high. */
const FLUID_KEYWORDS = /\b(soft|drapey|flowing|fluid|relaxed|loose|oversized)\b/i;
const STRUCTURED_KEYWORDS = /\b(structured|tailored|sharp|defined|tailoring|fitted|slim)\b/i;

/** Trend keywords in style: classic/timeless/traditional → low; runway/experimental/trendy/bold → high. */
const TREND_LOW_KEYWORDS = /\b(classic|timeless|traditional|conservative)\b/i;
const TREND_HIGH_KEYWORDS = /\b(runway|experimental|trendy|bold|avant|edgy)\b/i;

/**
 * Build evidence payload for Style Code (no LLM). Returns suggestedScore and source per dimension.
 * @param {StyleReportLook[]} byLooks
 * @param {StyleReportByItems} byItems
 * @param {object} styleProfile - Flat + comprehensive
 * @param {Array<{ hex: string, weight: number, isNeutral: boolean }>} allItemsForColor
 * @param {Array<{ id: string, labelLeft: string, labelRight: string }>} styleCodeDimensions
 * @returns {Object<string, { suggestedScore: number | null, source: string }>}
 */
function buildStyleCodeEvidencePayload(byLooks, byItems, styleProfile, allItemsForColor, styleCodeDimensions) {
  const comprehensive = styleProfile?.comprehensive;
  const elements = comprehensive?.elements || {};
  const payload = {};

  const dimensionIds = (styleCodeDimensions || []).map((d) => d.id);

  if (dimensionIds.includes("colour")) {
    const weightedSat = weightedSaturation(allItemsForColor);
    let totalItems = allItemsForColor.length;
    let neutralCount = allItemsForColor.filter((c) => c.isNeutral).length;
    const neutralRatio = totalItems > 0 ? neutralCount / totalItems : 0;
    let baseScore = weightedSat != null ? (weightedSat / 100) * 10 : 5;
    if (neutralRatio > 0.6) baseScore = baseScore * 0.7;
    const colourScore = Math.max(0, Math.min(10, Math.round(baseScore)));
    const compColour = elements.colour_palette?.sub_elements;
    let nudge = null;
    if (compColour && typeof compColour === "object") {
      for (const key of Object.keys(compColour)) {
        const v = scaleToScore(compColour[key]);
        if (v != null) {
          nudge = v;
          break;
        }
      }
    }
    const final = nudge != null ? Math.round((colourScore + nudge) / 2) : colourScore;
    payload.colour = {
      suggestedScore: Math.max(0, Math.min(10, final)),
      source: weightedSat != null
        ? `weightedSaturation ${Math.round(weightedSat)}%, neutralRatio ${neutralRatio.toFixed(2)}`
        : "comprehensive colour_palette only",
    };
  }

  if (dimensionIds.includes("formAndFit")) {
    const scores = [];
    for (const look of byLooks) {
      for (const it of look.itemsSummary || []) {
        const sum = toItemSummary(it, look.lookId);
        const text = [sum.description, sum.category].filter(Boolean).join(" ");
        if (!text) continue;
        if (FIT_LOW_KEYWORDS.test(text)) scores.push(2);
        else if (FIT_HIGH_KEYWORDS.test(text)) scores.push(8);
      }
    }
    let itemScore = null;
    if (scores.length > 0) {
      itemScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    }
    const compFit = elements.silhouette_and_fit?.sub_elements;
    let compScore = null;
    if (compFit && typeof compFit === "object") {
      for (const key of Object.keys(compFit)) {
        const v = scaleToScore(compFit[key]);
        if (v != null) {
          compScore = v;
          break;
        }
      }
    }
    let suggested = compScore;
    if (itemScore != null && compScore != null) suggested = (itemScore + compScore) / 2;
    else if (itemScore != null) suggested = itemScore;
    payload.formAndFit = {
      suggestedScore: suggested != null ? Math.max(0, Math.min(10, Math.round(suggested))) : null,
      source: itemScore != null && compScore != null
        ? "item keywords + comprehensive silhouette_and_fit"
        : itemScore != null
          ? "item fit keywords"
          : compScore != null
            ? "comprehensive silhouette_and_fit"
            : "insufficient evidence",
    };
  }

  if (dimensionIds.includes("trendAppetite")) {
    const scores = [];
    for (const look of byLooks) {
      for (const it of look.itemsSummary || []) {
        const sum = toItemSummary(it, look.lookId);
        const text = (sum.style || "").toLowerCase();
        if (!text) continue;
        if (TREND_LOW_KEYWORDS.test(text)) scores.push(2);
        else if (TREND_HIGH_KEYWORDS.test(text)) scores.push(8);
      }
    }
    let itemScore = null;
    if (scores.length > 0) {
      itemScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    }
    let compScore = null;
    for (const key of ["trend_preference", "temporal_orientation"]) {
      const sub = elements[key]?.sub_elements;
      if (sub && typeof sub === "object") {
        for (const k of Object.keys(sub)) {
          const v = scaleToScore(sub[k]);
          if (v != null) {
            compScore = compScore == null ? v : (compScore + v) / 2;
          }
        }
      }
    }
    let suggested = compScore;
    if (itemScore != null && compScore != null) suggested = (itemScore + compScore) / 2;
    else if (itemScore != null) suggested = itemScore;
    payload.trendAppetite = {
      suggestedScore: suggested != null ? Math.max(0, Math.min(10, Math.round(suggested))) : null,
      source: itemScore != null && compScore != null
        ? "item style + comprehensive trend/temporal"
        : itemScore != null
          ? "item style keywords"
          : compScore != null
            ? "comprehensive trend_preference/temporal_orientation"
            : "insufficient evidence",
    };
  }

  if (dimensionIds.includes("expression")) {
    let itemsPerLookSum = 0;
    let lookCount = 0;
    for (const look of byLooks) {
      const n = (look.itemsSummary || []).length;
      if (n > 0) {
        itemsPerLookSum += n;
        lookCount += 1;
      }
    }
    const avgItems = lookCount > 0 ? itemsPerLookSum / lookCount : 0;
    let itemScore = null;
    if (avgItems <= 3) itemScore = 3;
    else if (avgItems >= 6) itemScore = 7;
    else itemScore = 5;
    let compScore = null;
    for (const key of ["expression_intensity", "construction_and_detail_sensitivity", "styling_strategy"]) {
      const sub = elements[key]?.sub_elements;
      if (sub && typeof sub === "object") {
        for (const k of Object.keys(sub)) {
          const v = scaleToScore(sub[k]);
          if (v != null) {
            compScore = compScore == null ? v : (compScore + v) / 2;
          }
        }
      }
    }
    let suggested = compScore;
    if (itemScore != null && compScore != null) suggested = (itemScore + compScore) / 2;
    else if (compScore != null) suggested = compScore;
    else suggested = itemScore;
    payload.expression = {
      suggestedScore: suggested != null ? Math.max(0, Math.min(10, Math.round(suggested))) : null,
      source: compScore != null
        ? "items per look + comprehensive expression elements"
        : "items per look only",
    };
  }

  return payload;
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
 * Build a short summary of how many looks each item (by description/category) appears in.
 * Used to ground Style Identity analysis in actual frequency—only call something a "pattern" if it appears in multiple looks.
 * @param {Array<{ lookId: string, itemsSummary: Array<{ description?: string, category?: string }> }>} byLooks
 * @returns {string} e.g. "In 4+ looks: sunglasses, white sneakers. In 2-3 looks: denim jacket. In 1 look: floral shirt."
 */
function buildLookFrequencySummary(byLooks) {
  const keyToLookIds = new Map();
  for (const look of byLooks) {
    for (const it of look.itemsSummary || []) {
      const key = (it?.description || it?.category || "item").trim().toLowerCase();
      if (!key) continue;
      if (!keyToLookIds.has(key)) keyToLookIds.set(key, new Set());
      keyToLookIds.get(key).add(look.lookId);
    }
  }
  const in4Plus = [];
  const in2To3 = [];
  const in1 = [];
  for (const [key, lookIds] of keyToLookIds) {
    const n = lookIds.size;
    const label = key;
    if (n >= 4) in4Plus.push(label);
    else if (n >= 2) in2To3.push(label);
    else in1.push(label);
  }
  const parts = [];
  if (in4Plus.length) parts.push(`In 4+ looks (recurring): ${in4Plus.slice(0, 15).join(", ")}`);
  if (in2To3.length) parts.push(`In 2-3 looks: ${in2To3.slice(0, 10).join(", ")}`);
  if (in1.length) parts.push(`In 1 look only: ${in1.slice(0, 15).join(", ")}`);
  return parts.join(". ") || "No item frequency data.";
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

    const col = normalizeColorForPalette(it.color) || "other";
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
 * Build unified style profile from by-looks, by-items, and last profile. Includes analytical observations,
 * style observations, interpretation, comprehensive dimensions, occasions/vibe, trend/experiment.
 * @param {Object} opts - { byLooks, byItems, lastStyleProfile, agentObjective?, agentTone?, generatedAt, lookCount }
 * @returns {Promise<{ styleProfileData: object, comprehensive: ComprehensiveProfile | null }>}
 */
async function buildStyleProfile(opts) {
  const { byLooks, byItems, lastStyleProfile, agentObjective, agentTone, generatedAt, lookCount } = opts;
  const tone = (agentTone && String(agentTone).trim()) || FALLBACK_TONE;
  const byLooksSnippet = JSON.stringify(
    byLooks.map((l) => ({
      vibe: l.vibe,
      occasion: l.occasion,
      timeOfDay: l.timeOfDay,
      labels: l.labels,
      comment: l.comment,
      analysisComment: l.analysisComment,
      suggestions: l.suggestions,
      classificationTags: l.classificationTags,
      pairingSummary: l.pairingSummary,
      itemsSummary: (l.itemsSummary || []).slice(0, 15).map((i) => ({
        type: i.type,
        description: i.description,
        category: i.category,
        color: i.color,
        style: i.style,
      })),
    })),
    null,
    0
  ).slice(0, 4000);
  const byItemsSnippet = JSON.stringify(byItems.aggregates, null, 0).slice(0, 1500);
  const existingSnippet =
    lastStyleProfile != null ? JSON.stringify(lastStyleProfile).slice(0, 1200) : "None yet.";
  const objectiveLine = agentObjective && String(agentObjective).trim()
    ? `\nAdditional objective to keep in mind: ${String(agentObjective).trim()}`
    : "";

  const prompt = `You are a fashion style analyst. Based on the user's recent looks (with per-look analysis and item breakdown) and item aggregates, produce a unified style profile. Tone: ${tone}

Data:
By-looks (each with vibe, occasion, comment, analysisComment, suggestions, pairingSummary, itemsSummary): ${byLooksSnippet}
By-items (aggregate counts): ${byItemsSnippet}
Existing style profile (if any): ${existingSnippet}${objectiveLine}

Respond with a single JSON object with these keys (use null or empty array where not inferrable):
- "analyticalObservations": string, 2-4 sentences on what appears in the images (garments, colors, fits, recurring pieces).
- "styleObservations": string, 2-4 sentences on style patterns across the looks (how they dress, mix pieces, level of formality).
- "interpretation": string, 2-3 sentences: patterns, tensions, style recipes, personality traits.
- "occasionsAndVibe": string, main occasions and overall vibe (e.g. "weekend casual, smart work, one bold evening").
- "trendAndExperiment": string, how they engage with trends and experimentation (classic vs trendy, safe vs bold).
- "dominantSilhouettes": string.
- "colorPalette": string.
- "formalityRange": string.
- "styleKeywords": array of strings.
- "oneLiner": string.
- "pairingTendencies": string or null.
- "elements": optional object. Keys: colour_palette, silhouette_and_fit, fabric_texture_and_feel, styling_strategy, trend_preference, construction_and_detail_sensitivity, expression_intensity, contextual_flexibility, temporal_orientation. Each value: { "label": "Human title", "sub_elements": { "key": { "value": "..." or [], "scale": ["low","medium","high"] optional } } }. Keep 1-3 sub_elements per dimension.
- "synthesis": { "style_descriptor_short", "style_descriptor_long" optional, "style_keywords", "one_line_takeaway", "dominant_categories", "dominant_colors", "dominant_silhouettes" }.
- "style_dna": { "archetype_name", "archetype_tagline" optional, "keywords", "dna_line" }.
- "ideas_for_you": { "within_style_zone": string[], "adjacent_style_zone": string[] } optional.

Output only valid JSON. No markdown or preamble.`;

  const out = await complete(
    [
      { role: "system", content: "You output only valid JSON. No markdown or preamble." },
      { role: "user", content: prompt },
    ],
    { responseFormat: "json_object", maxTokens: STYLE_PROFILE_MAX_TOKENS, temperature: 0.3 }
  );

  if (!out || typeof out !== "object") {
    return { styleProfileData: {}, comprehensive: null };
  }

  const styleProfileData = {
    analyticalObservations: out.analyticalObservations ?? null,
    styleObservations: out.styleObservations ?? null,
    interpretation: out.interpretation ?? null,
    occasionsAndVibe: out.occasionsAndVibe ?? null,
    trendAndExperiment: out.trendAndExperiment ?? null,
    dominantSilhouettes: out.dominantSilhouettes ?? null,
    colorPalette: out.colorPalette ?? null,
    formalityRange: out.formalityRange ?? null,
    styleKeywords: Array.isArray(out.styleKeywords) ? out.styleKeywords : [],
    oneLiner: out.oneLiner ?? null,
    pairingTendencies: out.pairingTendencies ?? null,
  };

  const comprehensive = normalizeComprehensive({
    elements: out.elements,
    synthesis: out.synthesis,
    style_dna: out.style_dna,
    ideas_for_you: out.ideas_for_you,
  });
  if (comprehensive) {
    comprehensive.meta = {
      version: "1",
      generated_at: generatedAt,
      generated_from_looks: lookCount,
    };
    Object.assign(styleProfileData, flatFromComprehensive(comprehensive, styleProfileData));
    styleProfileData.comprehensive = comprehensive;
  }

  return { styleProfileData, comprehensive };
}

/**
 * Validate and coerce two-word identity to exactly one word from styleSignals and one from expressionModes.
 * Order: STYLE_SIGNAL then EXPRESSION_MODE. Ignores "Your", "Style", and any word not in the lists.
 * @returns {string} "Word1 Word2"
 */
function enforceTwoWordFromLists(rawTwoWord, styleSignals, expressionModes) {
  const signals = (styleSignals || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  const modes = (expressionModes || []).map((m) => String(m).trim().toLowerCase()).filter(Boolean);
  const signalSet = new Set(signals);
  const modeSet = new Set(modes);
  const words = typeof rawTwoWord === "string"
    ? rawTwoWord.trim().split(/\s+/).filter((w) => w && !/^(your|style)$/i.test(w))
    : [];
  let foundSignal = null;
  let foundMode = null;
  for (const w of words) {
    const lower = w.toLowerCase();
    if (signalSet.has(lower)) foundSignal = lower;
    else if (modeSet.has(lower)) foundMode = lower;
  }
  const word1 = foundSignal || signals[0] || "Classic";
  const word2 = foundMode || modes[0] || "Relaxed";
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  return `${capitalize(word1)} ${capitalize(word2)}`;
}

/**
 * Generate the Style Identity card: 2-word identity (STYLE_SIGNAL + EXPRESSION_MODE), up to 5 keywords, one-line quote (max 15 words), and short analysis.
 * Words must be chosen strictly from the provided lists. Quote and analysis align with overall report objective and tone.
 * Analysis must use the look-frequency data: only describe something as a pattern or "often" if it appears in multiple looks.
 * @param {object} styleProfile - Full style profile (includes looks-derived summary, analyticalObservations, styleObservations, etc.)
 * @param {{ styleSignals: string[], expressionModes: string[] }} styleIdentityOptions
 * @param {string|null} agentObjective - Overall report objective (insightful, relatable, actionable)
 * @param {string|null} agentTone - Tone for output
 * @param {string} [lookFrequencySummary] - "In N looks: item1, item2..." so analysis reflects actual frequency
 * @returns {Promise<{ title: string, content: string, twoWordIdentity: string, keywords: string[], quote: string, analysis: string }>}
 */
async function generateStyleIdentityCard(styleProfile, styleIdentityOptions, agentObjective, agentTone, lookFrequencySummary) {
  const profileSnippet = JSON.stringify(styleProfile).slice(0, 3200);
  const styleSignals = styleIdentityOptions?.styleSignals || [];
  const expressionModes = styleIdentityOptions?.expressionModes || [];
  const signalsList = styleSignals.join(", ");
  const modesList = expressionModes.join(", ");
  const tone = (agentTone && String(agentTone).trim()) || FALLBACK_TONE;
  const objectiveSnippet = (agentObjective && String(agentObjective).trim())
    ? String(agentObjective).trim().slice(0, 600)
    : "The report should be insightful, relatable, and actionable. Content should feel real and personally relevant.";
  const frequencyBlock = (lookFrequencySummary && String(lookFrequencySummary).trim())
    ? `\n\nLook frequency (how many looks each item appears in—use this for the analysis; do not invent patterns): ${lookFrequencySummary}`
    : "";

  const systemPrompt = `You are generating a 2-word Style Identity. You MUST follow these rules:
1. Word 1 must be EXACTLY one word from the STYLE SIGNAL OPTIONS list below (copy it exactly).
2. Word 2 must be EXACTLY one word from the EXPRESSION MODE OPTIONS list below (copy it exactly).
3. Do not use any word that is not in the lists. Do not use "Trendsetter", "Your", "Style", or any other extra text—only two words total.
4. Order: first word = STYLE SIGNAL, second word = EXPRESSION MODE. Example: "Minimal Mysterious" or "Trendy Effortless".

STYLE SIGNAL OPTIONS (choose exactly one): ${signalsList}

EXPRESSION MODE OPTIONS (choose exactly one): ${modesList}

Return only valid JSON. No markdown or preamble.`;

  const userPrompt = `Overall report objective (align the quote and analysis with this): ${objectiveSnippet}

Tone for the quote and analysis: ${tone}

Style profile (detailed JSON from all looks, items, and analysis—use this to choose the two words and to write quote and analysis): ${profileSnippet}${frequencyBlock}

CRITICAL for the "analysis" field: Use the "Look frequency" data above. Only describe something as a pattern, "often", or "go-to" if it appears in "4+ looks" or "2-3 looks". Do NOT describe anything that appears in "1 look only" as recurring or as a pattern. Prefer mentioning items that appear in most looks (4+). If the frequency list is missing, do not invent patterns—only refer to what the style profile text explicitly supports.

Return a JSON object with:
- "twoWordIdentity": string, exactly two words separated by a space. First word must be one of: ${signalsList}. Second word must be one of: ${modesList}. No other words (no "Your", no "Style").
- "keywords": array of 3 to 5 short words or phrases that describe this style (for display pills). Natural language.
- "quote": string, a single statement of 10 to 15 words that captures something interesting about this style in a humorous and endearing way. Be natural and specific to the profile—not a generic punchline. Align with the overall objective and tone above. Avoid sounding like a forced tagline; it should feel real and personally relevant. No quotation marks in the string. Required.
- "analysis": string, a short analysis of what this style identity means for the reader: up to 40 words, about 5 lines when wrapped. Write addressing the reader as "you" (e.g. "You tend to…", "Your style…"). Do not use third person (they/their). Align with the overall objective and tone. Keep a light, warm humour in the prose (similar to the quote)—it should feel endearing and slightly playful, not dry. Reference specific observations from the user's looks using the style profile and the Look frequency data: only call something a pattern or "often" if it appears in 2+ looks; mention items that appear in most looks; do not describe one-off items as recurring. Plain prose, no bullets.`;

  const out = await complete(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { responseFormat: "json_object", maxTokens: CARD_GENERATION_MAX_TOKENS, temperature: 0.3 }
  );
  if (!out || typeof out !== "object") {
    return {
      title: "Style Identity",
      content: "",
      twoWordIdentity: styleSignals[0] && expressionModes[0] ? `${styleSignals[0]} ${expressionModes[0]}` : "Classic Relaxed",
      keywords: [],
      quote: "Style is what you make it.",
      analysis: "",
    };
  }
  const rawTwo = typeof out.twoWordIdentity === "string" ? out.twoWordIdentity.trim() : "";
  const twoWord = enforceTwoWordFromLists(rawTwo, styleSignals, expressionModes);
  const keywords = Array.isArray(out.keywords)
    ? out.keywords.filter((k) => typeof k === "string" && k.trim()).map((k) => String(k).trim()).slice(0, 5)
    : [];
  let quote = typeof out.quote === "string" && out.quote.trim()
    ? String(out.quote).trim().slice(0, 120)
    : "";
  if (!quote) quote = "Style is what you make it.";
  const analysis = typeof out.analysis === "string" && out.analysis.trim()
    ? String(out.analysis).trim().slice(0, 280)
    : "";
  return {
    title: "Style Identity",
    content: quote || twoWord,
    twoWordIdentity: twoWord,
    keywords,
    quote,
    analysis,
  };
}

/** Rubric for Style Code (0 / 5 / 10) for LLM prompt. */
const STYLE_CODE_RUBRIC = `Dimension meanings (0 = left pole, 10 = right pole):
- trendAppetite: 0 = classic/timeless, avoids trends; 5 = mix; 10 = runway/experimental, trend-forward.
- formAndFit: 0 = comfort/relaxed, loose fits; 5 = mix; 10 = structured/fitted, sharp, tailored.
- expression: 0 = minimal, simple, few layers; 5 = balanced; 10 = layered, detailed, maximal.
- colour: 0 = soft, muted, neutrals; 5 = mixed; 10 = bold, bright, high saturation.`;

/**
 * Generate the Style Code card: config-driven dimensions (0–10) from evidence payload + LLM reconcile.
 * @param {object} styleProfile - Full style profile (flat + comprehensive)
 * @param {StyleReportLook[]} byLooks
 * @param {StyleReportByItems} byItems
 * @param {Object<string, { suggestedScore: number | null, source: string }>} evidencePayload
 * @param {Array<{ id: string, labelLeft: string, labelRight: string }>} styleCodeDimensions
 * @param {string|null} agentObjective
 * @param {string|null} agentTone
 * @returns {Promise<{ title: string, content: string, dimensions: Array<{ id: string, labelLeft: string, labelRight: string, score: number }> }>}
 */
async function generateStyleCodeCard(styleProfile, byLooks, byItems, evidencePayload, styleCodeDimensions, agentObjective, agentTone) {
  const dimensions = styleCodeDimensions && styleCodeDimensions.length >= 1
    ? styleCodeDimensions
    : [
        { id: "trendAppetite", labelLeft: "Classic, Timeless", labelRight: "Runway, Experimental" },
        { id: "formAndFit", labelLeft: "Comfort, relaxed", labelRight: "Structured, fitted" },
        { id: "expression", labelLeft: "Minimal, Simple", labelRight: "Layered, Detailed" },
        { id: "colour", labelLeft: "Soft, muted", labelRight: "Bold, Bright" },
      ];

  const fallbackDimensions = dimensions.map((d) => ({
    id: d.id,
    labelLeft: d.labelLeft,
    labelRight: d.labelRight,
    score: 5,
  }));

  const dimensionIds = dimensions.map((d) => d.id);
  const evidenceLines = dimensionIds.map((id) => {
    const ev = evidencePayload?.[id];
    const sug = ev?.suggestedScore != null ? ev.suggestedScore : "none";
    return `${id}: suggestedScore=${sug}, source=${ev?.source ?? "none"}`;
  }).join("\n");

  const profileSnippet = JSON.stringify({
    trendAndExperiment: styleProfile?.trendAndExperiment,
    dominantSilhouettes: styleProfile?.dominantSilhouettes,
    colorPalette: styleProfile?.colorPalette,
    styleObservations: styleProfile?.styleObservations,
    interpretation: styleProfile?.interpretation,
  }).slice(0, 2000);

  const keysList = dimensionIds.join(", ");
  const systemPrompt = `You output a Style Code: one score (0-10 integer) and one evidenceUsed (short sentence) per dimension. Use ONLY the evidence provided. If evidence is insufficient for a dimension, set score to 5 and evidenceUsed to "Insufficient evidence; based on profile text only." Return only valid JSON with keys: ${keysList}. Each value must be an object: { "score": number, "evidenceUsed": string }. No markdown or preamble.`;
  const userPrompt = `Evidence payload (use these to set scores; do not guess beyond the evidence):
${evidenceLines}

${STYLE_CODE_RUBRIC}

Flat profile snippet: ${profileSnippet}

Return a JSON object. For each of ${keysList}, provide { "score": 0-10 integer, "evidenceUsed": "one short sentence citing which data you used" }.`;

  try {
    const out = await complete(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { responseFormat: "json_object", maxTokens: 600, temperature: 0.2 }
    );
    if (!out || typeof out !== "object") {
      return { title: "Style Code", content: "", dimensions: fallbackDimensions };
    }

    const result = [];
    for (const d of dimensions) {
      const raw = out[d.id];
      let score = typeof raw === "object" && raw !== null && Number.isFinite(raw.score)
        ? Math.max(0, Math.min(10, Math.round(raw.score)))
        : (evidencePayload?.[d.id]?.suggestedScore != null
          ? Math.max(0, Math.min(10, Math.round(evidencePayload[d.id].suggestedScore)))
          : 5);
      if (d.id === "colour" && evidencePayload?.colour?.suggestedScore != null) {
        const evSat = evidencePayload.colour.suggestedScore;
        if (Math.abs(score - evSat) > 3) {
          score = evSat;
        }
      }
      result.push({ id: d.id, labelLeft: d.labelLeft, labelRight: d.labelRight, score });
    }
    return { title: "Style Code", content: "", dimensions: result };
  } catch (_) {
    return { title: "Style Code", content: "", dimensions: fallbackDimensions };
  }
}

/**
 * Generate the Style Signature (Style Thumbprint) card: exactly 3 observations, one sentence each, warm and humorous.
 * @param {object} styleProfile - Full style profile (flat + comprehensive)
 * @param {string|null} agentObjective
 * @param {string|null} agentTone
 * @returns {Promise<{ title: string, content: string, observations: Array<{ number: number, text?: string, serious: string, humorous: string }> }>}
 */
async function generateStyleSignatureCard(styleProfile, agentObjective, agentTone) {
  const profileSnippet = JSON.stringify(styleProfile).slice(0, 3200);
  const tone = (agentTone && String(agentTone).trim()) || FALLBACK_TONE;
  const objectiveLine = agentObjective && String(agentObjective).trim()
    ? ` Align with overall objective: ${String(agentObjective).trim().slice(0, 400)}`
    : "";

  const systemPrompt = `You output exactly 3 style observations for a "Style Thumbprint" card. Each observation has TWO parts (both required, each up to 10 words):
- "serious": one line, the factual/insightful observation. Direct—no filler (the UI shows "Signature", "Tell", "Absent"). No "Your signature is...", "The tell of your style is...", etc.
- "humorous": one line, the funny/witty take (will be shown in italics). Up to 10 words.

Tone: warm and humorous; keep it sharp and witty. Use neutral fashion vocabulary.

Return only valid JSON with key "observations": array of 3 objects, each with "number" (1, 2, or 3), "serious" (string, max 10 words), "humorous" (string, max 10 words). No markdown or preamble.`;
  const userPrompt = `Style profile: ${profileSnippet}

Tone: ${tone}${objectiveLine}

For each observation give "serious" (one line, max 10 words, direct content only—no filler) and "humorous" (one line, max 10 words, funny take). Do NOT start serious with "Your signature...", "The tell of your style...", "Surprisingly absent...".

1. SIGNATURE: Serious = what recurs in most of their looks (basis of their style); humorous = witty take. Example serious: "Pairing bold florals with neutral bottoms." Example humorous: "Like a fashion magician who keeps it chic."
2. THE TELL: Serious = that one thing very "you"; humorous = funny twist. Example serious: "Those sunglasses that say vacation on errands." Example humorous: "I'm on vacation even at the grocery store."
3. ABSENT: Serious = what they almost never do or what's not seen; humorous = light punchline. Example serious: "No stuffy formal wear." Example humorous: "Who needs a tie when you've got graphic tees?"

Return JSON: { "observations": [ { "number": 1, "serious": "...", "humorous": "..." }, { "number": 2, "serious": "...", "humorous": "..." }, { "number": 3, "serious": "...", "humorous": "..." } ] }`;

  const fallbackObservations = [
    { number: 1, serious: "Your style has a clear signature.", humorous: "You know what works." },
    { number: 2, serious: "There's one thing that's unmistakably you.", humorous: "Your tell is strong." },
    { number: 3, serious: "You steer clear of what doesn't fit.", humorous: "No fashion FOMO here." },
  ];

  try {
    const out = await complete(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { responseFormat: "json_object", maxTokens: 500, temperature: 0.35 }
    );
    if (!out || !Array.isArray(out.observations) || out.observations.length < 3) {
      return { title: "Style Thumbprint", content: "", observations: fallbackObservations };
    }
    const stripFiller = (rawText) => {
      let t = String(rawText).trim().slice(0, 200);
      const fillers = [
        /^your signature move is\s+/i,
        /^your signature is\s+/i,
        /^their signature is\s+/i,
        /^the tell of your style is\s+/i,
        /^the tell is\s+/i,
        /^your tell is\s+/i,
        /^what's absent is\s+/i,
        /^what is absent is\s+/i,
        /^surprisingly absent from your wardrobe (?:is|are)\s+/i,
        /^surprisingly absent from your wardrobe are any signs of\s+/i,
        /^absent from your wardrobe (?:is|are)\s+/i,
        /^what (?:is|are) absent (?:is|are)\s+/i,
      ];
      for (const re of fillers) t = t.replace(re, "");
      t = t.trim();
      if (t.length > 0 && t[0]) t = t[0].toUpperCase() + t.slice(1);
      return t || String(rawText).trim().slice(0, 200);
    };
    const toMaxWords = (str, max) => {
      const words = String(str).trim().split(/\s+/).filter(Boolean);
      return words.slice(0, max).join(" ") || String(str).trim();
    };
    const observations = out.observations
      .slice(0, 3)
      .filter((o) => o && typeof o.number === "number")
      .map((o) => {
        const num = Math.min(3, Math.max(1, Number(o.number)));
        const hasNew = typeof o.serious === "string" && typeof o.humorous === "string";
        const serious = hasNew
          ? toMaxWords(stripFiller(String(o.serious).trim()), 10)
          : stripFiller(String(o.text || "").trim()).slice(0, 80);
        const humorous = hasNew ? toMaxWords(stripFiller(String(o.humorous).trim()), 10) : "";
        return { number: num, serious, humorous };
      });
    const byNum = { 1: observations.find((o) => o.number === 1), 2: observations.find((o) => o.number === 2), 3: observations.find((o) => o.number === 3) };
    const ordered = [byNum[1], byNum[2], byNum[3]].filter(Boolean);
    const final = ordered.length >= 3 ? ordered : fallbackObservations;
    return { title: "Style Thumbprint", content: "", observations: final };
  } catch (_) {
    return { title: "Style Thumbprint", content: "", observations: fallbackObservations };
  }
}

/**
 * Generate the Ideas for you card from comprehensive.ideas_for_you and profile.
 * Returns three sections: inYourZone (elevate), zoneAdjacent (adjacent style), whereIsTheZone (experimental but practical).
 * @param {object} styleProfile - Full style profile (flat + comprehensive)
 * @param {string|null} agentObjective
 * @param {string|null} agentTone
 * @returns {Promise<{ title: string, content?: string, sections: { inYourZone: { description: string, items: string[] }, zoneAdjacent: { description: string, items: string[] }, whereIsTheZone: { description: string, items: string[] } }, ideas?: { within?: string[], adjacent?: string[] } }>}
 */
async function generateIdeasForYouCard(styleProfile, agentObjective, agentTone) {
  const ideasForYou = styleProfile?.comprehensive?.ideas_for_you;
  const within = Array.isArray(ideasForYou?.within_style_zone) ? ideasForYou.within_style_zone : [];
  const adjacent = Array.isArray(ideasForYou?.adjacent_style_zone) ? ideasForYou.adjacent_style_zone : [];
  const profileSnippet = JSON.stringify(styleProfile).slice(0, 3000);
  const tone = (agentTone && String(agentTone).trim()) || FALLBACK_TONE;
  const objectiveLine = agentObjective && String(agentObjective).trim()
    ? ` Align with: ${String(agentObjective).trim().slice(0, 300)}`
    : "";

  const systemPrompt = `You generate an "Ideas for you" card for a style report with exactly THREE sections. Apply the given tone and objective to all text.

Return only valid JSON with key "sections" (object with three keys). For each section:
- "description": string (2-4 sentences explaining the section and type of ideas).
- "items": string[] with exactly ONE idea, max 10 words (concise, concrete). So each section has one idea only.
- "vibe": string (1-2 words, e.g. "casual", "chic", "relaxed") for look composition.
- "occasion": string (1-2 words, e.g. "day out", "elevate", "explore") for look composition.

Sections: inYourZone (elevate within their style), zoneAdjacent (adjacent zone, stretch), whereIsTheZone (experimental but practical).

Also return "title" (e.g. "Ideas for you"). Optionally "content" (short intro). No markdown or preamble.`;

  const userPrompt = `Tone: ${tone}${objectiveLine}

Within-style zone ideas (elevate within their style): ${within.length ? JSON.stringify(within) : "None—derive from profile."}
Adjacent-style zone ideas (stretch, next zone): ${adjacent.length ? JSON.stringify(adjacent) : "None—derive from profile."}

Style profile: ${profileSnippet}

Return JSON: title, optional content, and sections: { inYourZone: { description, items: [one idea max 10 words], vibe, occasion }, zoneAdjacent: { description, items: [one idea max 10 words], vibe, occasion }, whereIsTheZone: { description, items: [one idea max 10 words], vibe, occasion } }. Each section has exactly ONE idea in items (10 words or fewer). vibe and occasion must be 1-2 words each for generating a look image.`;

  const fallbackSection = (label, vibeOccasion = { vibe: "casual", occasion: "day out" }) => ({
    description: `Ideas in this zone: suggestions tailored to the user's style. Use the full profile to generate when you regenerate.`,
    items: [],
    imagePrompt: "",
    vibe: vibeOccasion.vibe,
    occasion: vibeOccasion.occasion,
    imageUrl: "",
  });
  const defaultSections = {
    inYourZone: fallbackSection("In Your Zone", { vibe: "casual", occasion: "elevate" }),
    zoneAdjacent: fallbackSection("Zone Adjacent", { vibe: "relaxed", occasion: "stretch" }),
    whereIsTheZone: fallbackSection("Where is the zone?", { vibe: "experimental", occasion: "explore" }),
  };

  try {
    const out = await complete(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { responseFormat: "json_object", maxTokens: CARD_GENERATION_MAX_TOKENS, temperature: 0.4 }
    );
    if (!out || typeof out !== "object") {
      return { title: "Ideas for you", content: "", sections: defaultSections };
    }
    const title = out.title && String(out.title).trim() ? String(out.title).trim() : "Ideas for you";
    const content = out.content && String(out.content).trim() ? String(out.content).trim() : "";

    const toMaxWords = (str, max) => {
      const words = String(str).trim().split(/\s+/).filter(Boolean);
      return words.slice(0, max).join(" ") || String(str).trim();
    };
    const norm = (sec) => {
      if (!sec || typeof sec !== "object") return { description: "", items: [], imagePrompt: "", vibe: "", occasion: "", imageUrl: "" };
      const desc = String(sec.description ?? "").trim().slice(0, 600);
      const rawItems = Array.isArray(sec.items)
        ? sec.items.filter((s) => typeof s === "string" && s.trim()).map((s) => String(s).trim())
        : [];
      const oneIdea = rawItems.length > 0 ? toMaxWords(rawItems[0], 10) : "";
      const items = oneIdea ? [oneIdea] : [];
      const imagePrompt = String(sec.imagePrompt ?? "").trim().slice(0, 200);
      const vibe = String(sec.vibe ?? "").trim().slice(0, 60) || null;
      const occasion = String(sec.occasion ?? "").trim().slice(0, 60) || null;
      return { description: desc, items, imagePrompt, vibe, occasion, imageUrl: "" };
    };

    const raw = out.sections && typeof out.sections === "object" ? out.sections : {};
    const sections = {
      inYourZone: raw.inYourZone ? norm(raw.inYourZone) : defaultSections.inYourZone,
      zoneAdjacent: raw.zoneAdjacent ? norm(raw.zoneAdjacent) : defaultSections.zoneAdjacent,
      whereIsTheZone: raw.whereIsTheZone ? norm(raw.whereIsTheZone) : defaultSections.whereIsTheZone,
    };
    if (!sections.inYourZone.description) sections.inYourZone = defaultSections.inYourZone;
    if (!sections.zoneAdjacent.description) sections.zoneAdjacent = defaultSections.zoneAdjacent;
    if (!sections.whereIsTheZone.description) sections.whereIsTheZone = defaultSections.whereIsTheZone;

    let ideas = undefined;
    if (sections.inYourZone.items.length || sections.zoneAdjacent.items.length) {
      ideas = {
        within: sections.inYourZone.items.slice(0, 5),
        adjacent: sections.zoneAdjacent.items.slice(0, 5),
      };
    }
    return { title, content, sections, ideas };
  } catch (_) {
    return { title: "Ideas for you", content: "", sections: defaultSections };
  }
}

/**
 * Generate look images for Ideas for you card sections using Look Composition.
 * Calls composeLook per section with vibe/occasion and attach imageUrl to each section.
 * @param {string} userId - Normalized user id for userContext
 * @param {{ inYourZone?: object, zoneAdjacent?: object, whereIsTheZone?: object }} sections - Mutable sections object; imageUrl will be set on each
 */
async function generateIdeasForYouSectionImages(userId, sections) {
  if (!userId || !sections || typeof sections !== "object") return;
  let userContext;
  try {
    const profile = await getUserProfile(userId);
    userContext = buildUserContextFromProfile(profile);
  } catch (e) {
    console.warn("[styleReportAgent] generateIdeasForYouSectionImages: getUserProfile failed", e?.message);
  }
  const imageStyle = "on_model";
  const sectionKeys = ["inYourZone", "zoneAdjacent", "whereIsTheZone"];
  for (const key of sectionKeys) {
    const sec = sections[key];
    if (!sec || (sec.vibe == null && sec.occasion == null)) continue;
    const vibe = sec.vibe && String(sec.vibe).trim() ? String(sec.vibe).trim().slice(0, 60) : undefined;
    const occasion = sec.occasion && String(sec.occasion).trim() ? String(sec.occasion).trim().slice(0, 60) : undefined;
    const ideaText = Array.isArray(sec.items) && sec.items[0]
      ? String(sec.items[0]).trim().slice(0, 120)
      : (sec.description && String(sec.description).trim() ? String(sec.description).trim().slice(0, 120) : undefined);
    if (!vibe && !occasion) continue;
    try {
      const result = await composeLook({
        vibe: vibe || undefined,
        occasion: occasion || undefined,
        ideaDescription: ideaText || undefined,
        userContext,
        generateImage: true,
        imageStyle,
      });
      if (result?.imageUrl) sections[key].imageUrl = result.imageUrl;
    } catch (err) {
      console.warn("[styleReportAgent] composeLook failed for Ideas section", key, err?.message);
    }
  }
}

/**
 * Build a colour summary from all items in all looks (extracted colours only). Used so the Colour Palette
 * card is based on every item in the report, not a subset of images.
 * @param {StyleReportLook[]} byLooks
 * @param {StyleReportByItems} byItems
 * @returns {{ colourCounts: string, perLookColours: string, totalItems: number }}
 */
function buildColourSummaryFromAllItems(byLooks, byItems) {
  const byColorCount = byItems?.aggregates?.byColor || {};
  const totalItems = byItems?.aggregates?.itemCount || 0;
  const countEntries = Object.entries(byColorCount)
    .filter(([name]) => name && String(name).toLowerCase() !== "other")
    .sort((a, b) => b[1] - a[1]);
  const colourCounts =
    countEntries.length > 0
      ? countEntries.map(([name, count]) => `${name} ${count}`).join(", ")
      : "No colour data";

  const perLookLines = (byLooks || []).slice(0, 20).map((look, i) => {
    const items = look.itemsSummary || [];
    const colours = items.map((it) => it.color || it.color_primary || "?").filter((c) => c && c !== "?");
    return `Look ${i + 1}: ${colours.length ? colours.join(", ") : "—"}`;
  });
  const perLookColours = perLookLines.length > 0 ? perLookLines.join(". ") : "No per-look data";

  return { colourCounts, perLookColours, totalItems };
}

/**
 * Build silhouette/fit summary from all items in all looks. Used so the Silhouette card is data-driven.
 * @param {StyleReportLook[]} byLooks
 * @param {StyleReportByItems} byItems
 * @param {object} styleProfile - For dominantSilhouettes, synthesis.dominant_silhouettes, elements.silhouette_and_fit
 * @returns {{ categoryCounts: string, perLookShapes: string, fitTendency: string, profileSnippet: string, totalItems: number }}
 */
function buildSilhouetteSummaryFromAllItems(byLooks, byItems, styleProfile) {
  const byCategoryCount = byItems?.aggregates?.byCategory || {};
  const totalItems = byItems?.aggregates?.itemCount || 0;
  const countEntries = Object.entries(byCategoryCount)
    .filter(([name]) => name && String(name).toLowerCase() !== "other")
    .sort((a, b) => b[1] - a[1]);
  const categoryCounts =
    countEntries.length > 0
      ? countEntries.map(([name, count]) => `${name} ${count}`).join(", ")
      : "No category data";

  const perLookLines = (byLooks || []).slice(0, 20).map((look, i) => {
    const items = look.itemsSummary || [];
    const categories = items.map((it) => it.category || it.category_lvl1 || it.description || "?").filter((c) => c && c !== "?");
    return `Look ${i + 1}: ${categories.length ? categories.join(", ") : "—"}`;
  });
  const perLookShapes = perLookLines.length > 0 ? perLookLines.join(". ") : "No per-look data";

  const scores = [];
  for (const look of byLooks || []) {
    for (const it of look.itemsSummary || []) {
      const sum = toItemSummary(it, look.lookId);
      const text = [sum.description, sum.category].filter(Boolean).join(" ");
      if (!text) continue;
      if (FIT_LOW_KEYWORDS.test(text)) scores.push(2);
      else if (FIT_HIGH_KEYWORDS.test(text)) scores.push(8);
    }
  }
  let fitTendency = "Mixed";
  if (scores.length > 0) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg <= 3.5) fitTendency = "Relaxed";
    else if (avg >= 6.5) fitTendency = "Structured";
  }

  const flat = styleProfile || {};
  const synthesis = styleProfile?.comprehensive?.synthesis;
  const elements = styleProfile?.comprehensive?.elements || {};
  const dominantSilhouettes = flat.dominantSilhouettes || (Array.isArray(synthesis?.dominant_silhouettes) ? synthesis.dominant_silhouettes.join(", ") : "");
  const silhouetteAndFit = elements.silhouette_and_fit ? JSON.stringify(elements.silhouette_and_fit).slice(0, 300) : "";
  const profileSnippet = [dominantSilhouettes, silhouetteAndFit].filter(Boolean).join(". ") || "No profile snippet";

  return { categoryCounts, perLookShapes, fitTendency, profileSnippet, totalItems };
}

/**
 * Build data for Look recipe card: silhouettes, structure sliders (structuredFluid, relaxedFitted), dominant accessories, dominant footwear.
 * @param {StyleReportLook[]} byLooks
 * @param {StyleReportByItems} byItems
 * @param {object} styleProfile
 * @returns {{ dominantSilhouettes: string[], relaxedFitted: number, structuredFluid: number, dominantAccessories: string[], dominantFootwear: string[] }}
 */
function buildLookRecipeSummary(byLooks, byItems, styleProfile) {
  const { categoryCounts, fitTendency } = buildSilhouetteSummaryFromAllItems(
    byLooks || [],
    byItems || { aggregates: {}, detailedBreakdown: {} },
    styleProfile || {}
  );
  const byCategoryCount = byItems?.aggregates?.byCategory || {};
  const countEntries = Object.entries(byCategoryCount)
    .filter(([name]) => name && String(name).toLowerCase() !== "other")
    .sort((a, b) => b[1] - a[1]);
  const dominantSilhouettes = countEntries.slice(0, 6).map(([name]) => name);

  const fitScores = [];
  const structureScores = [];
  for (const look of byLooks || []) {
    for (const it of look.itemsSummary || []) {
      const sum = toItemSummary(it, look.lookId);
      const text = [sum.description, sum.category].filter(Boolean).join(" ");
      if (!text) continue;
      if (FIT_LOW_KEYWORDS.test(text)) fitScores.push(2);
      else if (FIT_HIGH_KEYWORDS.test(text)) fitScores.push(8);
      if (FLUID_KEYWORDS.test(text)) structureScores.push(2);
      else if (STRUCTURED_KEYWORDS.test(text)) structureScores.push(8);
    }
  }
  const relaxedFitted = fitScores.length > 0
    ? Math.round(Math.max(0, Math.min(10, fitScores.reduce((a, b) => a + b, 0) / fitScores.length)))
    : 5;
  const structuredFluid = structureScores.length > 0
    ? Math.round(Math.max(0, Math.min(10, structureScores.reduce((a, b) => a + b, 0) / structureScores.length)))
    : 5;

  const byTypeItems = byItems?.detailedBreakdown?.byType || {};
  const accessoryItems = byTypeItems.accessory || [];
  let footwearItems = byTypeItems.footwear || [];
  const categoryCount = (arr) => {
    const m = {};
    for (const it of arr) {
      const c = (it.category || it.description || "Other").trim();
      if (c && c.toLowerCase() !== "other") m[c] = (m[c] || 0) + 1;
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([name]) => name);
  };
  const dominantAccessories = categoryCount(accessoryItems).slice(0, 5);
  let dominantFootwear = categoryCount(footwearItems).slice(0, 5);

  const FOOTWEAR_KEYWORDS = /\b(sneaker|sneakers|shoe|shoes|boot|boots|loafer|loafers|sandals?|heels?|trainers?|oxford|mule|slip-on|canvas)\b/i;
  if (footwearItems.length === 0) {
    const allItems = [];
    for (const look of byLooks || []) {
      for (const it of look.itemsSummary || []) {
        const sum = toItemSummary(it, look.lookId);
        allItems.push(sum);
      }
    }
    const footwearFromDescription = allItems.filter((it) => {
      const text = [it.description, it.category].filter(Boolean).join(" ").toLowerCase();
      return FOOTWEAR_KEYWORDS.test(text);
    });
    if (footwearFromDescription.length > 0) {
      footwearItems = footwearFromDescription;
      dominantFootwear = categoryCount(footwearFromDescription).slice(0, 5);
    }
  }

  return {
    dominantSilhouettes,
    relaxedFitted,
    structuredFluid,
    dominantAccessories,
    dominantFootwear,
  };
}

/** Card-type-specific prompt focus for mood/insight cards (colour, silhouette, trends, styling). */
function getCardTypePromptFocus(cardTypeId) {
  switch (cardTypeId) {
    case "colour_analysis":
      return "Focus on: (1) colour mood—how their palette feels; (2) one or two concrete insights from their actual colours (dominant_colors, colorPalette); (3) one interesting observation (pattern, tension, or suggestion). Tone: distinctive and specific. Return title, content (2-4 sentences or bullets), and optionally colors: string[] for pills.";
    case "look_recipe":
      return "Focus on: (1) how their look comes together—silhouettes, structure, accessories, footwear; (2) one or two concrete insights. Return title, content.";
    case "trends":
      return "Focus on: (1) trend mood—how they engage with trends (classic, selective, experimental); (2) one or two insights from their style and items (trendAndExperiment, trend_preference, temporal_orientation); (3) one interesting observation or suggestion. Return title, content.";
    case "styling":
      return "Focus on: (1) styling mood—how they put looks together (minimal, layered, intentional); (2) one or two insights from their profile (styling_strategy, expression_intensity, construction_and_detail_sensitivity, items per look); (3) one interesting observation or suggestion. Return title, content.";
    default:
      return null;
  }
}

/**
 * Build a short text summary for the Trends card from style profile (trendAndExperiment, trend_preference, temporal_orientation).
 * @param {object} styleProfile - Full style profile (flat + comprehensive)
 * @returns {string}
 */
function buildTrendsSummary(styleProfile) {
  const flat = styleProfile || {};
  const elements = styleProfile?.comprehensive?.elements || {};
  const trendAndExperiment = flat.trendAndExperiment && String(flat.trendAndExperiment).trim();
  const trendPref = elements.trend_preference ? JSON.stringify(elements.trend_preference).slice(0, 400) : "";
  const temporal = elements.temporal_orientation ? JSON.stringify(elements.temporal_orientation).slice(0, 300) : "";
  const parts = [trendAndExperiment, trendPref, temporal].filter(Boolean);
  return parts.length > 0 ? parts.join(". ") : "No trend preference data.";
}

/**
 * Generate Trends card with structured payload: moodLabel, insights, suggestion.
 * @param {object} styleProfile - Full style profile
 * @param {string|null} agentObjective
 * @param {string|null} agentTone
 * @returns {Promise<{ title: string, content: string, moodLabel?: string, insights?: string[], suggestion?: string }>}
 */
async function generateTrendsCard(styleProfile, agentObjective, agentTone) {
  const tone = (agentTone && String(agentTone).trim()) || FALLBACK_TONE;
  const objectiveLine = agentObjective && String(agentObjective).trim()
    ? ` Overall report objective: ${String(agentObjective).trim()}`
    : "";
  const trendsSummary = buildTrendsSummary(styleProfile);
  const profileSnippet = JSON.stringify(styleProfile).slice(0, 2500);

  const systemContent = "You output only valid JSON. No markdown or preamble.";
  const prompt = `You are a fashion style analyst writing the Trends card for a style report. Tone: ${tone}${objectiveLine}

Trends card focus: (1) trend mood—how they engage with trends (classic, selective, experimental); (2) one or two insights from their style and items (trendAndExperiment, trend_preference, temporal_orientation); (3) one interesting observation or suggestion.

Trend-related profile data: ${trendsSummary}

Full style profile (for context): ${profileSnippet}

Return a JSON object with:
- "title": string, short card title (e.g. "Trends" or "How you do trends").
- "content": string, 2–4 sentences of insight about how they engage with trends. Specific to the profile. No filler.
- "moodLabel": string, one word or short phrase for their trend mood. Exactly one of: "Classic", "Selective", "Experimental", or a close variant (e.g. "Timeless", "Trend-curious", "Bold").
- "insights": array of 2–3 short strings (one sentence or phrase each), concrete insights from their profile.
- "suggestion": string, optional one-line idea to try (e.g. one trend or experiment to consider). Omit or empty if not relevant.

Output only valid JSON. No markdown or preamble.`;

  let out = null;
  try {
    out = await complete(
      [
        { role: "system", content: systemContent },
        { role: "user", content: prompt },
      ],
      { responseFormat: "json_object", maxTokens: CARD_GENERATION_MAX_TOKENS, temperature: 0.35 }
    );
  } catch (err) {
    console.warn("[styleReportAgent] Trends card failed:", err?.message);
  }

  if (!out || typeof out !== "object") {
    return {
      title: "Trends",
      content: "",
      moodLabel: "Selective",
      insights: [],
    };
  }

  const title = out.title && String(out.title).trim() ? out.title.trim() : "Trends";
  const content = out.content && String(out.content).trim() ? out.content.trim() : "";
  const moodLabel = out.moodLabel && String(out.moodLabel).trim() ? out.moodLabel.trim() : undefined;
  const insights = Array.isArray(out.insights)
    ? out.insights.slice(0, 4).map((s) => String(s).trim()).filter(Boolean)
    : [];
  const suggestion = out.suggestion && String(out.suggestion).trim() ? out.suggestion.trim() : undefined;

  return { title, content, ...(moodLabel && { moodLabel }), ...(insights.length > 0 && { insights }), ...(suggestion && { suggestion }) };
}

/**
 * Build a short text summary for the Styling card from style profile and byLooks (styling_strategy, expression_intensity, construction_and_detail_sensitivity, items per look).
 * @param {object} styleProfile - Full style profile
 * @param {StyleReportLook[]} byLooks - All looks (for items-per-look count)
 * @returns {string}
 */
function buildStylingSummary(styleProfile, byLooks) {
  const elements = styleProfile?.comprehensive?.elements || {};
  const stylingStrategy = elements.styling_strategy ? JSON.stringify(elements.styling_strategy).slice(0, 400) : "";
  const expressionIntensity = elements.expression_intensity ? JSON.stringify(elements.expression_intensity).slice(0, 300) : "";
  const constructionDetail = elements.construction_and_detail_sensitivity
    ? JSON.stringify(elements.construction_and_detail_sensitivity).slice(0, 300)
    : "";
  const lookLines = (byLooks || []).slice(0, 20).map((look, idx) => {
    const items = look.itemsSummary || [];
    const count = items.length || (look.itemsByType
      ? (look.itemsByType.clothing?.length || 0) + (look.itemsByType.footwear?.length || 0) + (look.itemsByType.accessory?.length || 0)
      : 0);
    return `Look ${idx + 1}: ${count} items`;
  });
  const itemsPerLook = lookLines.length > 0 ? lookLines.join("; ") : "No per-look data.";
  const parts = [stylingStrategy, expressionIntensity, constructionDetail, `Items per look: ${itemsPerLook}`].filter(Boolean);
  return parts.length > 0 ? parts.join(". ") : "No styling profile data.";
}

/**
 * Generate Styling card with structured payload: moodLabel, insights, suggestion.
 * @param {object} styleProfile - Full style profile
 * @param {StyleReportLook[]} byLooks - All looks (for items-per-look summary)
 * @param {string|null} agentObjective
 * @param {string|null} agentTone
 * @returns {Promise<{ title: string, content: string, moodLabel?: string, insights?: string[], suggestion?: string }>}
 */
async function generateStylingCard(styleProfile, byLooks, agentObjective, agentTone) {
  const tone = (agentTone && String(agentTone).trim()) || FALLBACK_TONE;
  const objectiveLine = agentObjective && String(agentObjective).trim()
    ? ` Overall report objective: ${String(agentObjective).trim()}`
    : "";
  const stylingSummary = buildStylingSummary(styleProfile, byLooks);
  const profileSnippet = JSON.stringify(styleProfile).slice(0, 2500);

  const systemContent = "You output only valid JSON. No markdown or preamble.";
  const prompt = `You are a fashion style analyst writing the Styling card for a style report. Tone: ${tone}${objectiveLine}

Styling card focus: (1) styling mood—how they put looks together (minimal, layered, intentional); (2) one or two insights from their profile (styling_strategy, expression_intensity, construction_and_detail_sensitivity, items per look); (3) one interesting observation or suggestion.

Styling-related profile data: ${stylingSummary}

Full style profile (for context): ${profileSnippet}

Return a JSON object with:
- "title": string, short card title (e.g. "Styling" or "How you put looks together").
- "content": string, 2–4 sentences of insight about how they style and layer. Specific to the profile. No filler.
- "moodLabel": string, one word or short phrase for their styling mood. Exactly one of: "Minimal", "Layered", "Intentional", or a close variant (e.g. "Edited", "Maximal", "Curated").
- "insights": array of 2–3 short strings (one sentence or phrase each), concrete insights from their profile.
- "suggestion": string, optional one-line idea to try (e.g. one styling move to consider). Omit or empty if not relevant.

Output only valid JSON. No markdown or preamble.`;

  let out = null;
  try {
    out = await complete(
      [
        { role: "system", content: systemContent },
        { role: "user", content: prompt },
      ],
      { responseFormat: "json_object", maxTokens: CARD_GENERATION_MAX_TOKENS, temperature: 0.35 }
    );
  } catch (err) {
    console.warn("[styleReportAgent] Styling card failed:", err?.message);
  }

  if (!out || typeof out !== "object") {
    return {
      title: "Styling",
      content: "",
      moodLabel: "Intentional",
      insights: [],
    };
  }

  const title = out.title && String(out.title).trim() ? out.title.trim() : "Styling";
  const content = out.content && String(out.content).trim() ? out.content.trim() : "";
  const moodLabel = out.moodLabel && String(out.moodLabel).trim() ? out.moodLabel.trim() : undefined;
  const insights = Array.isArray(out.insights)
    ? out.insights.slice(0, 4).map((s) => String(s).trim()).filter(Boolean)
    : [];
  const suggestion = out.suggestion && String(out.suggestion).trim() ? out.suggestion.trim() : undefined;

  return { title, content, ...(moodLabel && { moodLabel }), ...(insights.length > 0 && { insights }), ...(suggestion && { suggestion }) };
}

/**
 * Generate Colour Analysis card from colour extracted from ALL items in ALL looks used for the report.
 * No image limit: we pass every item's colour (counts + per-look breakdown) so the model sees the full picture.
 * Base palette = colours used fairly often across items. Preferred accents = colours that appear as accents.
 * Combination idea = NEW 3-colour combo: base + bold + accent.
 * @param {object} styleProfile - Full style profile (for context)
 * @param {StyleReportLook[]} byLooks - All looks (for per-look item colours)
 * @param {StyleReportByItems} byItems - Aggregates from all items (colour counts)
 * @param {string|null} agentObjective
 * @param {string|null} agentTone
 * @returns {Promise<{ title: string, content: string, basePalette: string[], accentPalette: string[], combinationIdea: string[] }>}
 */
async function generateColourAnalysisCard(styleProfile, byLooks, byItems, agentObjective, agentTone) {
  const tone = (agentTone && String(agentTone).trim()) || FALLBACK_TONE;
  const objectiveLine = agentObjective && String(agentObjective).trim()
    ? ` Overall report objective: ${String(agentObjective).trim()}`
    : "";

  const { colourCounts, perLookColours, totalItems } = buildColourSummaryFromAllItems(
    byLooks || [],
    byItems || { aggregates: {}, detailedBreakdown: {} }
  );

  const canonicalColorList = getCanonicalColorNames().join(", ");
  const systemContent = "You output only valid JSON. No markdown or preamble.";
  const dataPrompt = `Colour data is from ALL items in ALL looks used to generate this report (${totalItems} items total). Use it as the single source of truth.

Colour counts (each colour name followed by how many items in that colour): ${colourCounts}

Per-look item colours (so you can see which colours appear in many looks vs as accents): ${perLookColours}

Canonical colour names (use these exact names for basePalette, preferredAccents, and combinationIdea so colours display correctly): ${canonicalColorList}

From this full data:
1) Base palette: Colours that are used fairly often across different items. Return as "basePalette": array of 3–6 colour names. Prefer names from the canonical list above (e.g. sky blue, powder blue, pink, cream, white, navy, blush, dusty rose).
2) Preferred accents: Colours that appear as accents—present in the wardrobe but in smaller doses. Return as "preferredAccents": array of 2–4 colour names. Use canonical names from the list above (e.g. red, black).
3) Content: "content": string, exactly 2 sentences (or up to 25 words) of colour insight. Reference their base and accent colours. No filler.
4) New combination idea: "combinationIdea": array of exactly 3 colour names. A NEW combo to try: one BASE (from their base palette or similar), one BOLD (stronger statement), one ACCENT (from preferred accents or a colour they could add). Use only canonical names from the list above. Tone: ${tone}${objectiveLine}

Return a JSON object with keys: basePalette, preferredAccents, content, combinationIdea.`;

  let out = null;
  try {
    out = await complete(
      [
        { role: "system", content: systemContent },
        { role: "user", content: dataPrompt },
      ],
      { responseFormat: "json_object", maxTokens: CARD_GENERATION_MAX_TOKENS, temperature: 0.35 }
    );
  } catch (err) {
    console.warn("[styleReportAgent] Colour Palette (all-items) failed:", err?.message);
  }

  if (!out || typeof out !== "object") {
    const profileSnippet = JSON.stringify(styleProfile).slice(0, 2200);
    const fallbackPrompt = `You are a fashion style analyst. Style profile (for context): ${profileSnippet}

Use these canonical colour names for basePalette, preferredAccents, and combinationIdea: ${canonicalColorList}

Return a JSON object with:
- "basePalette": array of 3–5 colour names the user likely uses as base (use only names from the canonical list above).
- "preferredAccents": array of 2–4 colour names they use as accents (use only names from the canonical list).
- "content": string, 2 sentences of colour insight. No filler.
- "combinationIdea": array of exactly 3 colour names: a NEW combo (base + bold + accent). Use only canonical names from the list. Tone: ${tone}${objectiveLine}

Output only valid JSON. No markdown or preamble.`;
    try {
      out = await complete(
        [
          { role: "system", content: systemContent },
          { role: "user", content: fallbackPrompt },
        ],
        { responseFormat: "json_object", maxTokens: CARD_GENERATION_MAX_TOKENS, temperature: 0.4 }
      );
    } catch (err) {
      console.warn("[styleReportAgent] Colour Palette fallback failed:", err?.message);
    }
  }

  const basePalette = Array.isArray(out?.basePalette)
    ? out.basePalette.slice(0, 6).map((c) => String(c).trim()).filter(Boolean)
    : [];
  const accentPalette = Array.isArray(out?.preferredAccents)
    ? out.preferredAccents.slice(0, 5).map((c) => String(c).trim()).filter(Boolean)
    : [];
  const content = out?.content && String(out.content).trim()
    ? out.content.trim()
    : "Your palette reflects how you dress day to day.";
  const rawCombo = Array.isArray(out?.combinationIdea)
    ? out.combinationIdea.slice(0, 3).map((c) => String(c).trim()).filter(Boolean)
    : [];
  const combinationIdea = rawCombo.length >= 3 ? rawCombo : [];

  return {
    title: "Colour Palette",
    content,
    basePalette,
    accentPalette,
    combinationIdea,
  };
}

/**
 * Generate Silhouette card from data from all items and looks (categories = shapes, fit keywords, profile).
 * @param {object} styleProfile
 * @param {StyleReportLook[]} byLooks
 * @param {StyleReportByItems} byItems
 * @param {string|null} agentObjective
 * @param {string|null} agentTone
 * @returns {Promise<{ title: string, content: string, goToShapes: string[], fitProfile: string, silhouetteIdea?: string }>}
 */
async function generateSilhouetteCard(styleProfile, byLooks, byItems, agentObjective, agentTone) {
  const tone = (agentTone && String(agentTone).trim()) || FALLBACK_TONE;
  const objectiveLine = agentObjective && String(agentObjective).trim()
    ? ` Overall report objective: ${String(agentObjective).trim()}`
    : "";

  const { categoryCounts, perLookShapes, fitTendency, profileSnippet, totalItems } = buildSilhouetteSummaryFromAllItems(
    byLooks || [],
    byItems || { aggregates: {}, detailedBreakdown: {} },
    styleProfile || {}
  );

  const systemContent = "You output only valid JSON. No markdown or preamble.";
  const dataPrompt = `You are a fashion style analyst. Data is from ALL items in ALL looks used to generate this report (${totalItems} items total). Use it as the source of truth.

Category counts (each category name followed by how many items): ${categoryCounts}

Per-look shapes (categories per look): ${perLookShapes}

Computed fit tendency from item descriptions: ${fitTendency}

Profile context: ${profileSnippet}

Return a JSON object with:
- "title": "Shape & Fit" (use exactly this).
- "goToShapes": array of 4–6 "go-to shapes" — the silhouettes/shapes they wear most (e.g. "Wide-leg trousers", "Fitted top", "Structured blazer"). Prefer names that match or normalise the categories above; use readable, title-case labels.
- "fitProfile": string — short label: "Relaxed", "Structured", or "Mixed" (you may use the computed tendency above or refine from context).
- "content": string, exactly 2 sentences (or up to 25 words) of insight about their silhouette and fit. No filler.
- "silhouetteIdea": string (optional) — one concrete suggestion to try (e.g. "Try a streamlined top with your wide-leg trousers"). Tone: ${tone}${objectiveLine}

Output only valid JSON. No markdown or preamble.`;

  let out = null;
  try {
    out = await complete(
      [
        { role: "system", content: systemContent },
        { role: "user", content: dataPrompt },
      ],
      { responseFormat: "json_object", maxTokens: CARD_GENERATION_MAX_TOKENS, temperature: 0.35 }
    );
  } catch (err) {
    console.warn("[styleReportAgent] Silhouette card failed:", err?.message);
  }

  const title = out?.title && String(out.title).trim() ? out.title.trim() : "Shape & Fit";
  const goToShapes = Array.isArray(out?.goToShapes)
    ? out.goToShapes.slice(0, 6).map((s) => String(s).trim()).filter(Boolean)
    : [];
  const fitProfile = out?.fitProfile && String(out.fitProfile).trim() ? out.fitProfile.trim() : fitTendency;
  const content = out?.content && String(out.content).trim()
    ? out.content.trim()
    : "Your shapes and fit reflect how you like to dress.";
  const silhouetteIdea = out?.silhouetteIdea && String(out.silhouetteIdea).trim() ? out.silhouetteIdea.trim() : undefined;

  return {
    title,
    content,
    goToShapes: goToShapes.length > 0 ? goToShapes : [],
    fitProfile,
    ...(silhouetteIdea && { silhouetteIdea }),
  };
}

/**
 * Generate Look recipe card: 4 blocks — Silhouette (specific pills), Structure (2 sliders), Accessories (insight), Footwear (insight).
 * @param {object} styleProfile
 * @param {StyleReportLook[]} byLooks
 * @param {StyleReportByItems} byItems
 * @param {string|null} agentObjective
 * @param {string|null} agentTone
 * @returns {Promise<{ title: string, content: string, dominantSilhouettes: string[], structureSliders: object, dominantAccessories: string[], dominantFootwear: string[], accessoriesInsight?: string, footwearInsight?: string }>}
 */
async function generateLookRecipeCard(styleProfile, byLooks, byItems, agentObjective, agentTone) {
  const summary = buildLookRecipeSummary(
    byLooks || [],
    byItems || { aggregates: {}, detailedBreakdown: {} },
    styleProfile || {}
  );
  const { categoryCounts, perLookShapes } = buildSilhouetteSummaryFromAllItems(
    byLooks || [],
    byItems || { aggregates: {}, detailedBreakdown: {} },
    styleProfile || {}
  );
  const byTypeItems = byItems?.detailedBreakdown?.byType || {};
  const accessoryItemsFull = (byTypeItems.accessory || []).map((it) => it.description || it.category || "").filter(Boolean);
  const accessoryItemsForPrompt = accessoryItemsFull.length ? accessoryItemsFull.join("; ") : "none";
  let footwearItemsRaw = (byTypeItems.footwear || []).map((it) => it.description || it.category || "").filter(Boolean);
  if (footwearItemsRaw.length === 0 && summary.dominantFootwear.length > 0) {
    footwearItemsRaw = summary.dominantFootwear;
  }
  const footwearItemsForPrompt = footwearItemsRaw.length ? footwearItemsRaw.join("; ") : "none";

  const profileSnippet = JSON.stringify(styleProfile).slice(0, 1200);
  const tone = (agentTone && String(agentTone).trim()) || FALLBACK_TONE;
  const objective = (agentObjective && String(agentObjective).trim()) || "";
  const objectiveLine = objective ? ` Overall report objective: ${objective}` : "";

  const systemContent = "You output only valid JSON. No markdown or preamble.";
  const dataPrompt = `You are a fashion style analyst. Answer based on the user's actual items and looks.
Report objective: ${objective || "Insightful, relatable, actionable."}
Tone: ${tone}

Category counts (shapes from items): ${categoryCounts}
Per-look shapes: ${perLookShapes}
Structure: relaxedFitted=${summary.relaxedFitted} (0=relaxed, 10=fitted), structuredFluid=${summary.structuredFluid} (0=fluid, 10=structured).
All accessory items (every item): ${accessoryItemsForPrompt}
All footwear items (every item): ${footwearItemsForPrompt}
Profile context: ${profileSnippet}
Trend-related profile (for trendObservation and trendAdaptivenessScore): ${buildTrendsSummary(styleProfile)}

Return a JSON object with:
- "title": "Look recipe" (use exactly this).
- "content": string, ONE short statement only. MAX 20 words. No filler. It must describe what their look recipe is (how they build their look—silhouettes, structure, accessories, footwear in one crisp sentence).${objectiveLine}
- "specificSilhouettes": array of 4-6 strings — SHAPE/SILHOUETTE only (cut, fit, style of garment). Do NOT include pattern (e.g. floral, striped, polka) or color (e.g. red, blue). Examples: "Button-up shirt", "Tailored trousers", "Relaxed-fit blouse", "Wide-legged trousers", "Structured blazer". Normalise from the category counts above to shape-only labels.
- "accessoriesInsight": string, MAX 15 words. How they use accessories: minimal vs many, statement vs subtle. No filler. If no data: "No accessories noted." (3 words).
- "footwearInsight": string, MAX 15 words. Preferred footwear type and whether varied or consistent. No filler. If footwear items listed above: use them (e.g. "Sneakers, casual and consistent."). If none: "No footwear noted." (3 words).
- "trendObservation": string, ONE phrase or short sentence (MAX 15 words). Name the TREND they follow using fashion terminology only—e.g. "Quiet luxury", "Minimalist tailoring", "Y2K-inspired accents", "Relaxed smart-casual", "New minimalism". Do NOT describe what they wear (avoid "You wear neutrals" or item lists). Articulate the trend name or trend space.
- "trendAdaptivenessScore": number 0–10. 0 = classic/timeless; 10 = experimental/runway. Based on trend-related profile above.

Output only valid JSON. No markdown or preamble.`;

  const trimTo20Words = (str) => {
    const s = String(str).trim().split(/\s+/).slice(0, 20).join(" ");
    return s.replace(/[,.]\s*$/, "").trim();
  };

  let title = "Look recipe";
  let content = "Your look: silhouettes, structure, accessories, footwear.";
  let specificSilhouettes = summary.dominantSilhouettes;
  let accessoriesInsight = "";
  let footwearInsight = "";
  let trendObservation = "";
  let trendAdaptivenessScore = 5;
  try {
    const out = await complete(
      [
        { role: "system", content: systemContent },
        { role: "user", content: dataPrompt },
      ],
      { responseFormat: "json_object", maxTokens: 600, temperature: 0.35 }
    );
    if (out?.title && String(out.title).trim()) title = String(out.title).trim();
    if (out?.content && String(out.content).trim()) content = trimTo20Words(out.content);
    if (Array.isArray(out?.specificSilhouettes) && out.specificSilhouettes.length > 0) {
      const stripPatternAndColor = (s) => {
        let t = String(s).trim();
        const drop = /\b(floral|striped|polka|checked|plaid|printed|red|blue|orange|white|black|navy|grey|gray)\b/gi;
        t = t.replace(drop, "").replace(/\s+/g, " ").trim();
        return t.replace(/^[\s\-–,]+|[\s\-–,]+$/g, "") || String(s).trim();
      };
      specificSilhouettes = out.specificSilhouettes.slice(0, 6).map(stripPatternAndColor).filter(Boolean);
    }
    const trimTo15Words = (str) => {
      const s = String(str).trim().split(/\s+/).slice(0, 15).join(" ");
      return s.replace(/[,.]\s*$/, "").trim();
    };
    if (out?.accessoriesInsight && String(out.accessoriesInsight).trim()) {
      accessoriesInsight = trimTo15Words(out.accessoriesInsight);
    }
    if (out?.footwearInsight && String(out.footwearInsight).trim()) {
      footwearInsight = trimTo15Words(out.footwearInsight);
    }
    if (out?.trendObservation && String(out.trendObservation).trim()) {
      trendObservation = trimTo15Words(out.trendObservation);
    }
    if (typeof out?.trendAdaptivenessScore === "number" && !Number.isNaN(out.trendAdaptivenessScore)) {
      trendAdaptivenessScore = Math.max(0, Math.min(10, Math.round(out.trendAdaptivenessScore)));
    }
  } catch (err) {
    console.warn("[styleReportAgent] Look recipe card LLM failed:", err?.message);
  }

  if (!trendObservation || !String(trendObservation).trim()) {
    const s = trendAdaptivenessScore;
    if (s <= 2) trendObservation = "Classic";
    else if (s <= 4) trendObservation = "Quiet luxury";
    else if (s <= 6) trendObservation = "Selective";
    else if (s <= 8) trendObservation = "Trend-curious";
    else trendObservation = "Experimental";
  }

  return {
    title,
    content,
    dominantSilhouettes: specificSilhouettes,
    structureSliders: {
      structuredFluid: summary.structuredFluid,
      relaxedFitted: summary.relaxedFitted,
    },
    dominantAccessories: summary.dominantAccessories,
    dominantFootwear: summary.dominantFootwear,
    ...(accessoriesInsight && { accessoriesInsight }),
    ...(footwearInsight && { footwearInsight }),
    ...(trendObservation && String(trendObservation).trim() && { trendObservation: String(trendObservation).trim() }),
    ...(typeof trendAdaptivenessScore === "number" && { trendAdaptivenessScore }),
  };
}

/**
 * Generate one report card content for a given card type from the style profile.
 * @param {string} cardTypeId - e.g. style_identity, style_signature, colour_analysis
 * @param {string} cardLabel - Human-readable label
 * @param {object} styleProfile - Full style profile (flat + comprehensive)
 * @param {string|null} agentObjective
 * @param {string|null} agentTone
 * @returns {Promise<{ title: string, content: string, [key: string]: any }>}
 */
async function generateOneCard(cardTypeId, cardLabel, styleProfile, agentObjective, agentTone) {
  const profileSnippet = JSON.stringify(styleProfile).slice(0, 3500);
  const objectiveLine = agentObjective && String(agentObjective).trim()
    ? ` Overall report objective (align this card to it): ${String(agentObjective).trim()}`
    : "";
  const tone = (agentTone && String(agentTone).trim()) || FALLBACK_TONE;
  const focusLine = getCardTypePromptFocus(cardTypeId);

  const prompt = `You are a fashion style analyst writing one card for a style report. Tone: ${tone}${objectiveLine}

Card type: ${cardLabel} (${cardTypeId}).
${focusLine ? `Card focus: ${focusLine}` : ""}
Style profile (use this to write the card): ${profileSnippet}

Return a JSON object with:
- "title": string, short card title (can match or vary the card type).
- "content": string, 2-5 sentences or short bullets for this card. Insightful and specific to the profile. No filler.
Add any extra keys useful for this card type (e.g. "colors" for colour_analysis). Output only valid JSON. No markdown or preamble.`;

  const out = await complete(
    [
      { role: "system", content: "You output only valid JSON. No markdown or preamble." },
      { role: "user", content: prompt },
    ],
    { responseFormat: "json_object", maxTokens: CARD_GENERATION_MAX_TOKENS, temperature: 0.4 }
  );
  if (!out || typeof out !== "object") return { title: cardLabel, content: "" };
  return {
    title: out.title || cardLabel,
    content: out.content || "",
    ...(out.keywords && { keywords: out.keywords }),
    ...(out.colors && { colors: out.colors }),
    ...(out.summary && { summary: out.summary }),
  };
}

/**
 * Validate that a card meets its card objective, design (clarity, structure), and overall report objective.
 * Returns { ok: boolean, reason?: string }. If not ok, caller should regenerate the card.
 */
async function validateCard(cardTypeId, cardLabel, cardPayload, overallObjective, agentTone) {
  const snippet = JSON.stringify(cardPayload).slice(0, 800);
  const objectiveSnippet = (overallObjective && String(overallObjective).trim())
    ? String(overallObjective).trim().slice(0, 400)
    : "Report should be insightful, relatable, and actionable.";
  const toneSnippet = (agentTone && String(agentTone).trim())
    ? String(agentTone).trim().slice(0, 200)
    : "Warm, concise, relatable.";
  const isStyleIdentity = cardTypeId === "style_identity";
  const isStyleSignature = cardTypeId === "style_signature";
  const isIdeasForYou = cardTypeId === "ideas_for_you";
  const cardObjectiveCheck = isStyleIdentity
    ? `1) Card objective: Does this Style Identity card have a valid two-word identity, a quote that feels insightful/relatable and not generic or contrived, and an analysis that addresses the reader as "you", references specific observations, and does NOT describe one-off items (worn once) as patterns or "often"?`
    : isStyleSignature
      ? `1) Card objective: Does this Style Thumbprint card have exactly 3 observations? Each has a "serious" line (insightful, direct, no filler) and a "humorous" line (witty take). 1 = signature (recurs in MOST looks); 2 = the "tell"; 3 = what is absent. Serious lines must not start with "Your signature is...", "The tell of your style is...", or "What's absent is...".`
      : isIdeasForYou
        ? `1) Card objective: Does this Ideas for you card have three sections (inYourZone, zoneAdjacent, whereIsTheZone)? Each section has a non-empty description. inYourZone describes suggestions that match the user's style and help elevate it; zoneAdjacent describes suggestions in the zone adjacent to their style; whereIsTheZone describes experimental but still practical ideas.`
        : `1) Card objective: Does this card fulfil its purpose for card type "${cardLabel}" (e.g. for "Colour Analysis" it should reflect their palette)?`;
  const designCheck = isStyleIdentity
    ? `2) Design: Is the quote natural and specific (not a forced tagline)? Is the analysis clear, in second person ("you"/"your"), grounded in items that actually recur in their looks (not one-off items as patterns), and easy to read?`
    : isStyleSignature
      ? `2) Design: Are all three observations clear and distinct (signature vs tell vs absent)? Does each have a serious line and a short humorous line? Does observation 1 (signature) describe a recurring pattern? No filler openings in serious lines.`
      : isIdeasForYou
        ? `2) Design: Are the three section descriptions clear, specific to the profile, and not generic? Does the tone match?`
        : `2) Design: Is the content clear, well-structured, and easy to scan (not generic or vague)?`;
  const prompt = `You are a quality checker for a style report card. Check ALL of the following:
${cardObjectiveCheck}
${designCheck}
3) Overall objective: Does it align with the overall report objective? Overall objective: ${objectiveSnippet}
4) Tone: Does it match this tone? ${toneSnippet}

Card type: ${cardLabel}. Card content: ${snippet}

If all four are satisfied, respond with { "ok": true }. Otherwise respond with { "ok": false, "reason": "brief specific reason" }. Output only valid JSON. No markdown or preamble.`;

  const out = await complete(
    [
      { role: "system", content: "You output only valid JSON. No markdown or preamble." },
      { role: "user", content: prompt },
    ],
    { responseFormat: "json_object", maxTokens: 200, temperature: 0.1 }
  );
  if (out && out.ok === true) return { ok: true };
  return { ok: false, reason: out?.reason || "Validation failed" };
}

/**
 * Resolve card type alias to the generator type id.
 */
function resolveCardTypeId(typeId) {
  if (typeId === "style_dna") return "style_signature";
  if (typeId === "style_recipe") return "ideas_for_you";
  if (typeId === "structure") return "trends";
  if (typeId === "fabrics") return "styling";
  if (typeId === "silhouette") return "look_recipe";
  return typeId;
}

/**
 * Generate a single card by type (used for parallel card generation).
 * @returns {Promise<{ id: string, type: string, title: string, content: string, [key: string]: any }>}
 */
async function generateSingleCard(
  typeId,
  index,
  label,
  styleProfile,
  styleIdentityOptions,
  styleCodeOptions,
  styleCodeEvidencePayload,
  byLooks,
  byItems,
  agentObjective,
  agentTone,
  lookFrequencySummary,
  userId,
  maxRetries
) {
  const resolved = resolveCardTypeId(typeId);
  let payload;

  if (resolved === "style_identity" && styleIdentityOptions) {
    payload = await generateStyleIdentityCard(styleProfile, styleIdentityOptions, agentObjective, agentTone, lookFrequencySummary);
    let validated = await validateCard(resolved, label, payload, agentObjective, agentTone);
    for (let r = 0; r < maxRetries && !validated.ok; r++) {
      try {
        payload = await generateStyleIdentityCard(styleProfile, styleIdentityOptions, agentObjective, agentTone, lookFrequencySummary);
        validated = await validateCard(resolved, label, payload, agentObjective, agentTone);
      } catch (_) {
        break;
      }
    }
    return {
      id: `card-${resolved}-${index}`,
      type: resolved,
      title: payload.title,
      content: payload.content,
      twoWordIdentity: payload.twoWordIdentity,
      keywords: payload.keywords,
      quote: payload.quote,
      analysis: payload.analysis,
    };
  }
  if (resolved === "style_signature") {
    payload = await generateStyleSignatureCard(styleProfile, agentObjective, agentTone);
    let validated = await validateCard(resolved, label, payload, agentObjective, agentTone);
    for (let r = 0; r < maxRetries && !validated.ok; r++) {
      try {
        payload = await generateStyleSignatureCard(styleProfile, agentObjective, agentTone);
        validated = await validateCard(resolved, label, payload, agentObjective, agentTone);
      } catch (_) {
        break;
      }
    }
    return {
      id: `card-${resolved}-${index}`,
      type: resolved,
      title: payload.title,
      content: payload.content,
      observations: payload.observations,
    };
  }
  if (resolved === "ideas_for_you") {
    payload = await generateIdeasForYouCard(styleProfile, agentObjective, agentTone);
    let validated = await validateCard(resolved, label, payload, agentObjective, agentTone);
    for (let r = 0; r < maxRetries && !validated.ok; r++) {
      try {
        payload = await generateIdeasForYouCard(styleProfile, agentObjective, agentTone);
        validated = await validateCard(resolved, label, payload, agentObjective, agentTone);
      } catch (_) {
        break;
      }
    }
    if (payload.sections && userId) {
      try {
        await generateIdeasForYouSectionImages(userId, payload.sections);
      } catch (err) {
        console.warn("[styleReportAgent] generateIdeasForYouSectionImages failed:", err?.message);
      }
    }
    return {
      id: `card-${resolved}-${index}`,
      type: resolved,
      title: payload.title,
      content: payload.content,
      sections: payload.sections,
      ...(payload.ideas && { ideas: payload.ideas }),
    };
  }
  if (resolved === "style_code") {
    const styleCodeDimensions = styleCodeOptions?.dimensions || [];
    const payloadStyleCode = await generateStyleCodeCard(
      styleProfile,
      byLooks || [],
      byItems || { aggregates: {}, detailedBreakdown: {} },
      styleCodeEvidencePayload || {},
      styleCodeDimensions,
      agentObjective,
      agentTone
    );
    return {
      id: `card-${resolved}-${index}`,
      type: resolved,
      title: payloadStyleCode.title,
      content: payloadStyleCode.content,
      dimensions: payloadStyleCode.dimensions,
    };
  }
  if (resolved === "colour_analysis") {
    payload = await generateColourAnalysisCard(
      styleProfile,
      byLooks || [],
      byItems || { aggregates: {}, detailedBreakdown: {} },
      agentObjective,
      agentTone
    );
    return {
      id: `card-${resolved}-${index}`,
      type: resolved,
      title: payload.title,
      content: payload.content,
      basePalette: payload.basePalette,
      accentPalette: payload.accentPalette,
      combinationIdea: payload.combinationIdea,
    };
  }
  if (resolved === "look_recipe") {
    payload = await generateLookRecipeCard(
      styleProfile,
      byLooks || [],
      byItems || { aggregates: {}, detailedBreakdown: {} },
      agentObjective,
      agentTone
    );
    return {
      id: `card-${resolved}-${index}`,
      type: resolved,
      title: payload.title,
      content: payload.content,
      dominantSilhouettes: payload.dominantSilhouettes,
      structureSliders: payload.structureSliders,
      dominantAccessories: payload.dominantAccessories,
      dominantFootwear: payload.dominantFootwear,
      ...(payload.accessoriesInsight && { accessoriesInsight: payload.accessoriesInsight }),
      ...(payload.footwearInsight && { footwearInsight: payload.footwearInsight }),
      ...(payload.trendObservation && { trendObservation: payload.trendObservation }),
      ...(typeof payload.trendAdaptivenessScore === "number" && { trendAdaptivenessScore: payload.trendAdaptivenessScore }),
    };
  }
  if (resolved === "trends") {
    payload = await generateTrendsCard(styleProfile, agentObjective, agentTone);
    return {
      id: `card-${resolved}-${index}`,
      type: resolved,
      title: payload.title,
      content: payload.content,
      ...(payload.moodLabel && { moodLabel: payload.moodLabel }),
      ...(payload.insights && payload.insights.length > 0 && { insights: payload.insights }),
      ...(payload.suggestion && { suggestion: payload.suggestion }),
    };
  }
  if (resolved === "styling") {
    payload = await generateStylingCard(styleProfile, byLooks || [], agentObjective, agentTone);
    return {
      id: `card-${resolved}-${index}`,
      type: resolved,
      title: payload.title,
      content: payload.content,
      ...(payload.moodLabel && { moodLabel: payload.moodLabel }),
      ...(payload.insights && payload.insights.length > 0 && { insights: payload.insights }),
      ...(payload.suggestion && { suggestion: payload.suggestion }),
    };
  }
  payload = await generateOneCard(resolved, label, styleProfile, agentObjective, agentTone);
  let validated = await validateCard(resolved, label, payload, agentObjective, agentTone);
  for (let r = 0; r < maxRetries && !validated.ok; r++) {
    try {
      payload = await generateOneCard(resolved, label, styleProfile, agentObjective, agentTone);
      validated = await validateCard(resolved, label, payload, agentObjective, agentTone);
    } catch (_) {
      break;
    }
  }
  return {
    id: `card-${resolved}-${index}`,
    type: resolved,
    title: payload.title,
    content: payload.content,
    ...(payload.keywords && { keywords: payload.keywords }),
    ...(payload.colors && { colors: payload.colors }),
    ...(payload.summary && { summary: payload.summary }),
  };
}

/**
 * Generate ordered report cards from style profile and card config. Cards are generated in parallel.
 * Each card is validated against card objective, design, and overall objective; up to two regenerations if validation fails.
 * @param {object} styleProfile - Full style profile
 * @param {{ cardOrder: string[], enabledCardTypes: string[] }} cardConfig
 * @param {{ styleSignals: string[], expressionModes: string[] }} [styleIdentityOptions] - for Style Identity card only
 * @param {{ dimensions: Array<{ id: string, labelLeft: string, labelRight: string }> }} [styleCodeOptions] - for Style Code card
 * @param {Object<string, { suggestedScore: number | null, source: string }>} [styleCodeEvidencePayload] - for Style Code card
 * @param {StyleReportLook[]} [byLooks] - for Style Code evidence
 * @param {StyleReportByItems} [byItems] - for Style Code evidence
 * @param {string|null} agentObjective - Overall report objective
 * @param {string|null} agentTone - Tone for output
 * @param {string} [lookFrequencySummary] - "In N looks: item1, item2..." so analysis uses actual frequency
 * @param {string} [userId] - Optional; when set, Ideas for you card uses Look Composition to generate section images
 * @returns {Promise<Array<{ id: string, type: string, title: string, content: string, [key: string]: any }>>}
 */
async function generateReportCards(styleProfile, cardConfig, styleIdentityOptions, styleCodeOptions, styleCodeEvidencePayload, byLooks, byItems, agentObjective, agentTone, lookFrequencySummary, userId) {
  const labelById = Object.fromEntries(STYLE_REPORT_CARD_TYPES.map((c) => [c.id, c.label]));
  const orderedTypes = (cardConfig.cardOrder || []).filter((id) =>
    (cardConfig.enabledCardTypes || []).includes(id)
  );
  const maxRetries = 2;
  const cards = await Promise.all(
    orderedTypes.map((typeId, i) => {
      const label = labelById[typeId] || typeId.replace(/_/g, " ");
      return generateSingleCard(
        typeId,
        i,
        label,
        styleProfile,
        styleIdentityOptions,
        styleCodeOptions,
        styleCodeEvidencePayload,
        byLooks || [],
        byItems || { aggregates: {}, detailedBreakdown: {} },
        agentObjective,
        agentTone,
        lookFrequencySummary,
        userId,
        maxRetries
      );
    })
  );
  return cards;
}

/**
 * Run Style Report Agent.
 * (1) Build style profile from latest 7–15 looks + last profile. (2) Generate card-based report from profile.
 * @param {Object} input - { userId: string, forceRegenerate?: boolean }
 * @returns {Promise<{ reportData: StyleReportData | null, styleProfileUpdated: boolean, notEnoughLooks?: boolean, message?: string }>}
 */
export async function run(input) {
  const userId = input?.userId;
  const uid = normalizeId(userId);
  if (!uid) throw new Error("userId required");

  const { minLooks, maxLooks, agentObjective, agentTone, cardConfig, styleIdentityOptions, styleCodeOptions } = await getStyleReportSettings();
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
  const generatedAt = new Date().toISOString();
  const existingProfile = await getUserProfile(uid);
  const lastStyleProfile = existingProfile?.styleProfile?.data ?? null;

  let styleProfileData = {};
  let comprehensive = null;
  try {
    const built = await buildStyleProfile({
      byLooks,
      byItems,
      lastStyleProfile,
      agentObjective,
      agentTone,
      generatedAt,
      lookCount: byLooks.length,
    });
    styleProfileData = built.styleProfileData;
    comprehensive = built.comprehensive;
  } catch (err) {
    console.warn("[styleReportAgent] buildStyleProfile failed:", err?.message);
  }

  await writeStyleProfile(uid, {
    source: "style_report_agent",
    data: styleProfileData,
  });

  const lookFrequencySummary = buildLookFrequencySummary(byLooks);

  const allItemsForColor = buildAllItemsForColor(byLooks);
  const styleProfileWithComprehensive = { ...styleProfileData, comprehensive };
  const styleCodeEvidencePayload = buildStyleCodeEvidencePayload(
    byLooks,
    byItems,
    styleProfileWithComprehensive,
    allItemsForColor,
    styleCodeOptions?.dimensions || []
  );

  let cards = [];
  try {
    cards = await generateReportCards(
      styleProfileData,
      cardConfig,
      styleIdentityOptions,
      styleCodeOptions,
      styleCodeEvidencePayload,
      byLooks,
      byItems,
      agentObjective,
      agentTone,
      lookFrequencySummary,
      uid
    );
  } catch (err) {
    console.warn("[styleReportAgent] generateReportCards failed:", err?.message);
  }

  const headline =
    styleProfileData.oneLiner ||
    styleProfileData.comprehensive?.synthesis?.style_descriptor_short ||
    "Your Style Report";

  const paletteRangeResult = paletteRange(allItemsForColor);
  const contrastLevelResult = contrastLevel(allItemsForColor);
  const weightedSaturationValue = weightedSaturation(allItemsForColor);

  const reportData = {
    version: REPORT_DATA_VERSION_CARDS,
    generatedAt,
    headline,
    cards,
    sections: cards.length > 0 ? cards.map((c) => ({ title: c.title, content: c.content })) : [],
    paletteRange: paletteRangeResult.classification,
    paletteRangeScore: paletteRangeResult.score,
    contrastLevel: contrastLevelResult.classification,
    contrastLevelScore: contrastLevelResult.level,
    weightedSaturationPercent: weightedSaturationValue,
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
  if (comprehensive) reportData.comprehensive = comprehensive;

  const lookFp = buildLookFingerprint(looks);
  const settingsFp = buildSettingsFingerprint({
    minLooks,
    maxLooks,
    agentObjective,
    agentTone,
    cardConfig,
    styleIdentityOptions,
    styleCodeOptions,
  });
  const inputFingerprint = buildStyleReportInputFingerprint(lookFp, settingsFp);
  await saveLatestStyleReport(uid, reportData, inputFingerprint);

  return {
    reportData,
    styleProfileUpdated: true,
  };
}
