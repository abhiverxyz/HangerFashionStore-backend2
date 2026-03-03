/**
 * Colour utilities: name→hex palette, hex↔HSL, palette range, contrast level, weighted saturation.
 * See docs/COLOR_AND_STYLE_IMPROVEMENTS.md and docs/COLOR_TERMINOLOGY.md.
 */

/** Canonical colour names → hex (one canonical hex per name so we get correct saturation/lightness from hex). */
const NAMED_COLOR_PALETTE = {
  black: "#0d0d0d",
  white: "#fafafa",
  off_white: "#f5f0e8",
  ivory: "#fffff0",
  cream: "#fffdd0",
  grey: "#808080",
  charcoal: "#36454f",
  silver: "#c0c0c0",
  slate: "#708090",
  navy: "#1e3a5f",
  midnight_blue: "#191970",
  blue: "#2563eb",
  powder_blue: "#b0e0e6",
  sky_blue: "#87ceeb",
  teal: "#008080",
  forest_green: "#228b22",
  green: "#16a34a",
  sage: "#9dc183",
  mint: "#98ff98",
  olive: "#808000",
  khaki: "#c3b091",
  mustard: "#ffdb58",
  yellow: "#eab308",
  gold: "#ffd700",
  amber: "#f59e0b",
  orange: "#ea580c",
  coral: "#ff7f50",
  terracotta: "#c75c3c",
  red: "#dc2626",
  burgundy: "#722f37",
  maroon: "#800000",
  wine: "#722f37",
  pink: "#ec4899",
  dusty_rose: "#c9a9a6",
  blush: "#de98ab",
  rose: "#e11d48",
  fuchsia: "#c026d3",
  purple: "#7c3aed",
  lavender: "#e879f9",
  violet: "#8b5cf6",
  plum: "#581c87",
  brown: "#78350f",
  tan: "#d2b48c",
  beige: "#d4b896",
  camel: "#c19a6b",
  rust: "#b7410e",
  light_blue: "#87ceeb",
};

/**
 * Neutral names → canonical palette key. Used so black/white/grey variants count once in the colour palette.
 * Keys: normalized (lowercase, spaces/underscores/hyphens normalized).
 */
const NEUTRAL_TO_CANONICAL = {
  black: "black",
  charcoal: "black",
  off_black: "black",
  dark_grey: "black",
  dark_gray: "black",
  white: "white",
  off_white: "white",
  ivory: "white",
  cream: "white",
  grey: "grey",
  gray: "grey",
  silver: "grey",
  slate: "grey",
  light_grey: "grey",
  light_gray: "grey",
};

/**
 * Normalize colour name for palette aggregation: map black/white/grey variants to a single canonical name each.
 * @param {string} colorName - e.g. "off-white", "charcoal", "dark grey"
 * @returns {string | null} "black" | "white" | "grey" for neutrals, or original trimmed name (or null if empty)
 */
export function normalizeColorForPalette(colorName) {
  if (!colorName || typeof colorName !== "string") return null;
  const key = colorName.trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  if (NEUTRAL_TO_CANONICAL[key]) return NEUTRAL_TO_CANONICAL[key];
  return colorName.trim() || null;
}

/**
 * Parse hex to r,g,b (0-255). Handles #RGB and #RRGGBB.
 * @returns {{ r: number, g: number, b: number } | null}
 */
function hexToRgb(hex) {
  if (!hex || typeof hex !== "string") return null;
  const s = hex.replace(/^#/, "").trim();
  if (/^[0-9A-Fa-f]{6}$/.test(s)) {
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16),
    };
  }
  if (/^[0-9A-Fa-f]{3}$/.test(s)) {
    return {
      r: parseInt(s[0] + s[0], 16),
      g: parseInt(s[1] + s[1], 16),
      b: parseInt(s[2] + s[2], 16),
    };
  }
  return null;
}

/**
 * Convert hex to HSL. H in [0, 360), S and L in [0, 100].
 * @returns {{ h: number, s: number, l: number } | null}
 */
export function hexToHSL(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
    }
  }
  return {
    h: h * 360,
    s: s * 100,
    l: l * 100,
  };
}

/**
 * Saturation (0-100) from hex. Use this for "the right number" instead of LLM output.
 */
export function saturationPercentFromHex(hex) {
  const hsl = hexToHSL(hex);
  return hsl ? hsl.s : null;
}

/**
 * Lightness (0-100) from hex.
 */
export function lightnessPercentFromHex(hex) {
  const hsl = hexToHSL(hex);
  return hsl ? hsl.l : null;
}

/**
 * Map colour name to canonical hex. Normalizes name (lowercase, trim, replace spaces with _).
 * @param {string} name - e.g. "Navy", "dusty rose"
 * @returns {string | null} hex or null if unknown
 */
export function nameToHex(name) {
  if (!name || typeof name !== "string") return null;
  const key = name.trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  if (NAMED_COLOR_PALETTE[key]) return NAMED_COLOR_PALETTE[key];
  for (const [k, hex] of Object.entries(NAMED_COLOR_PALETTE)) {
    if (k.replace(/_/g, "") === key.replace(/_/g, "")) return hex;
  }
  return null;
}

/**
 * Classify lightness (0-100) into "dark" | "medium" | "light".
 */
export function classifyBrightness(lightnessPercent) {
  if (lightnessPercent == null || typeof lightnessPercent !== "number") return null;
  if (lightnessPercent < 33) return "dark";
  if (lightnessPercent < 66) return "medium";
  return "light";
}

/**
 * Classify saturation (0-100) into "muted" | "medium" | "vivid".
 */
export function classifySaturation(saturationPercent) {
  if (saturationPercent == null || typeof saturationPercent !== "number") return null;
  if (saturationPercent < 25) return "muted";
  if (saturationPercent < 60) return "medium";
  return "vivid";
}

/**
 * Resolve color from LLM: name or hex. Returns { hex, saturationPercent, lightnessPercent, isNeutral, brightnessLabel, saturationLabel }.
 * If name is given, map to hex then compute; if hex given, use it and compute.
 */
export function resolveColor(nameOrHex) {
  let hex = null;
  if (typeof nameOrHex === "string" && nameOrHex.trim()) {
    const s = nameOrHex.trim();
    if (/^#?[0-9A-Fa-f]{3,6}$/.test(s)) hex = s.startsWith("#") ? s : `#${s}`;
    else hex = nameToHex(s);
  }
  if (!hex) return null;
  let hex6 = hex.replace(/^#/, "");
  if (hex6.length === 3) hex6 = hex6[0] + hex6[0] + hex6[1] + hex6[1] + hex6[2] + hex6[2];
  hex6 = "#" + hex6.toLowerCase();
  const hsl = hexToHSL(hex6);
  if (!hsl) return null;
  const isNeutral = hsl.s < 15 || (hsl.l <= 15) || (hsl.l >= 92);
  return {
    hex: hex6,
    saturationPercent: hsl.s,
    lightnessPercent: hsl.l,
    isNeutral,
    brightnessLabel: classifyBrightness(hsl.l),
    saturationLabel: classifySaturation(hsl.s),
  };
}

/**
 * Weighted saturation: sum(freq_i * saturation_i) / sum(freq_i) over chromatic colours.
 * @param {Array<{ hex: string, weight?: number, isNeutral?: boolean }>} colorsWithWeights
 * @returns {number | null} 0-100 or null if no chromatic colours
 */
export function weightedSaturation(colorsWithWeights) {
  if (!Array.isArray(colorsWithWeights) || colorsWithWeights.length === 0) return null;
  let sumWS = 0;
  let sumW = 0;
  for (const c of colorsWithWeights) {
    if (c.isNeutral) continue;
    const hex = c.hex || (c.color_hex);
    const s = saturationPercentFromHex(hex);
    if (s == null) continue;
    const w = typeof c.weight === "number" ? c.weight : (c.frequency ?? 1);
    sumWS += w * s;
    sumW += w;
  }
  if (sumW <= 0) return null;
  return sumWS / sumW;
}

/** Angular distance between two hues (0-360), in [0, 180]. */
function hueDistance(h1, h2) {
  let d = Math.abs(h1 - h2);
  if (d > 180) d = 360 - d;
  return d;
}

/**
 * Palette range: colour variety from chromatic colours. Score 0-1; classification.
 * @param {Array<{ hex: string, weight?: number, isNeutral?: boolean }>} colorsWithWeights
 * @returns {{ score: number, classification: string, chromaticCount: number, neutralWeightRatio: number }}
 */
export function paletteRange(colorsWithWeights) {
  if (!Array.isArray(colorsWithWeights) || colorsWithWeights.length === 0) {
    return { score: 0, classification: "narrow-neutral", chromaticCount: 0, neutralWeightRatio: 1 };
  }
  let totalWeight = 0;
  let neutralWeight = 0;
  const chromatic = [];
  for (const c of colorsWithWeights) {
    const w = typeof c.weight === "number" ? c.weight : (c.frequency ?? 1);
    totalWeight += w;
    if (c.isNeutral) neutralWeight += w;
    else {
      const hex = c.hex || c.color_hex;
      const hsl = hexToHSL(hex);
      if (hsl) chromatic.push({ ...hsl, weight: w });
    }
  }
  const neutralWeightRatio = totalWeight > 0 ? neutralWeight / totalWeight : 1;
  if (neutralWeightRatio > 0.7 || chromatic.length <= 1) {
    return {
      score: 0,
      classification: "narrow-neutral",
      chromaticCount: chromatic.length,
      neutralWeightRatio,
    };
  }
  const totalCW = chromatic.reduce((a, c) => a + c.weight, 0);
  if (totalCW <= 0) {
    return { score: 0, classification: "narrow-neutral", chromaticCount: 0, neutralWeightRatio };
  }
  let hueSpread = 0;
  if (chromatic.length >= 2) {
    let sumDist = 0;
    let count = 0;
    for (let i = 0; i < chromatic.length; i++) {
      for (let j = i + 1; j < chromatic.length; j++) {
        const d = hueDistance(chromatic[i].h, chromatic[j].h);
        const w = chromatic[i].weight * chromatic[j].weight;
        sumDist += d * w;
        count += w;
      }
    }
    hueSpread = count > 0 ? sumDist / count / 180 : 0;
  }
  const sVals = chromatic.map((c) => c.s);
  const lVals = chromatic.map((c) => c.l);
  const satRange = (Math.max(...sVals) - Math.min(...sVals)) / 100;
  const lightRange = (Math.max(...lVals) - Math.min(...lVals)) / 100;
  const score = (hueSpread + satRange + lightRange) / 3;
  let classification = "narrow";
  if (score >= 0.42) classification = "wide";
  else if (score >= 0.18) classification = "moderate";
  return {
    score,
    classification,
    chromaticCount: chromatic.length,
    neutralWeightRatio,
  };
}

/**
 * HSL distance between two colours (0-1 scale). Weighted: hue (circular) + sat + light.
 */
function hslDistance(hsl1, hsl2) {
  const hDist = hueDistance(hsl1.h, hsl2.h) / 180;
  const sDist = Math.abs(hsl1.s - hsl2.s) / 100;
  const lDist = Math.abs(hsl1.l - hsl2.l) / 100;
  return (hDist * 0.5 + sDist * 0.25 + lDist * 0.25);
}

/**
 * Contrast level: weighted pairwise HSL distance. Detects black+white.
 * @param {Array<{ hex: string, weight?: number }>} colorsWithWeights
 * @returns {{ level: number, classification: string, hasBlackWhite: boolean }}
 */
export function contrastLevel(colorsWithWeights) {
  if (!Array.isArray(colorsWithWeights) || colorsWithWeights.length === 0) {
    return { level: 0, classification: "soft", hasBlackWhite: false };
  }
  const withHSL = colorsWithWeights
    .map((c) => {
      const hex = c.hex || c.color_hex;
      const hsl = hexToHSL(hex);
      if (!hsl) return null;
      const w = typeof c.weight === "number" ? c.weight : (c.frequency ?? 1);
      return { ...hsl, weight: w };
    })
    .filter(Boolean);
  if (withHSL.length < 2) {
    return { level: 0, classification: "soft", hasBlackWhite: false };
  }
  let hasBlackWhite = false;
  for (let i = 0; i < withHSL.length; i++) {
    for (let j = i + 1; j < withHSL.length; j++) {
      const a = withHSL[i];
      const b = withHSL[j];
      if ((a.l <= 18 && b.l >= 85) || (b.l <= 18 && a.l >= 85)) hasBlackWhite = true;
    }
  }
  if (hasBlackWhite) {
    return { level: 1, classification: "high-neutral", hasBlackWhite: true };
  }
  let sumDist = 0;
  let sumW = 0;
  for (let i = 0; i < withHSL.length; i++) {
    for (let j = i + 1; j < withHSL.length; j++) {
      const d = hslDistance(withHSL[i], withHSL[j]);
      const w = withHSL[i].weight * withHSL[j].weight;
      sumDist += d * w;
      sumW += w;
    }
  }
  const level = sumW > 0 ? sumDist / sumW : 0;
  let classification = "soft";
  if (level >= 0.34) classification = "bold";
  else if (level >= 0.2) classification = "medium";
  return { level, classification, hasBlackWhite: false };
}

/**
 * Get list of canonical colour names for prompts (so LLM picks from this list).
 */
export function getCanonicalColorNames() {
  return Object.keys(NAMED_COLOR_PALETTE).map((k) => k.replace(/_/g, " "));
}
