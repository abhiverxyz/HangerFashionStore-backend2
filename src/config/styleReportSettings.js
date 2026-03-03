/**
 * Style report agent settings: min/max looks, agent objective, tone, card config.
 * Agent uses latest looks in [minLooks, maxLooks]. Card config defines which cards and order.
 */

import { getPrisma } from "../core/db.js";

const DEFAULT_MIN = 7;
const DEFAULT_MAX = 15;
const ID = "default";

/** Default overall objective for the style report agent (used when none set in DB). */
export const DEFAULT_AGENT_OBJECTIVE = `Generate a style report that is:
1. Insightful for the user and truly captures style taste. It is not generic and feels specific to the user. It captures what works and the tensions as well.
2. Relatable. Frames it in a manner that the user can easily understand and resonate with.
3. Actionable. Has things that the user can do easily. This report should also be easily used for personalization.`;

/** Default tone for style report output (used when none set in DB). */
export const DEFAULT_AGENT_TONE =
  "Be insightful, concise, and use natural language with no filler. Sound relatable, warm, and lightly humorous. Content should feel real and personally relevant to the user.";

/** Default card type ids for style report (order and labels). */
export const STYLE_REPORT_CARD_TYPES = [
  { id: "style_identity", label: "Style Identity" },
  { id: "style_code", label: "Style Code" },
  { id: "style_signature", label: "Style Signature" },
  { id: "ideas_for_you", label: "Ideas for you" },
  { id: "colour_analysis", label: "Colour Analysis" },
  { id: "look_recipe", label: "Look recipe" },
  { id: "trends", label: "Trends" },
  { id: "styling", label: "Styling" },
];

const DEFAULT_CARD_ORDER = STYLE_REPORT_CARD_TYPES.map((c) => c.id);
const DEFAULT_CARD_CONFIG = {
  cardOrder: DEFAULT_CARD_ORDER,
  enabledCardTypes: [...DEFAULT_CARD_ORDER],
};

/** Default Style Identity card: STYLE SIGNAL options (word 1). */
export const DEFAULT_STYLE_SIGNALS = [
  "Eclectic", "Adventurous", "Bold", "Maximal", "Creative", "Street", "Sporty", "Trendy", "Modern", "Edgy",
  "Classic", "Timeless", "Elegant", "Sharp", "Tailored", "Relaxed", "Casual", "Minimal", "Understated", "Practical",
];

/** Default Style Identity card: EXPRESSION MODE options (word 2). */
export const DEFAULT_EXPRESSION_MODES = [
  "Understated", "Quiet", "Subtle", "Relaxed", "Natural", "Effortless", "Balanced", "Intentional",
  "Confident", "Poised", "Playful", "Expressive", "Dramatic", "Glamorous", "Flamboyant", "Mysterious", "Enigmatic", "Approachable",
];

const DEFAULT_STYLE_IDENTITY_OPTIONS = {
  styleSignals: [...DEFAULT_STYLE_SIGNALS],
  expressionModes: [...DEFAULT_EXPRESSION_MODES],
};

/** Default Style Code card: 4 dimensions (id, labelLeft, labelRight). */
const DEFAULT_STYLE_CODE_DIMENSIONS = [
  { id: "trendAppetite", labelLeft: "Classic, Timeless", labelRight: "Runway, Experimental" },
  { id: "formAndFit", labelLeft: "Comfort, relaxed", labelRight: "Structured, fitted" },
  { id: "expression", labelLeft: "Minimal, Simple", labelRight: "Layered, Detailed" },
  { id: "colour", labelLeft: "Soft, muted", labelRight: "Bold, Bright" },
];

const DEFAULT_STYLE_CODE_OPTIONS = { dimensions: [...DEFAULT_STYLE_CODE_DIMENSIONS] };

function normalizeStyleIdentityOptions(raw) {
  const styleSignals = Array.isArray(raw?.styleSignals)
    ? raw.styleSignals.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim())
    : DEFAULT_STYLE_IDENTITY_OPTIONS.styleSignals;
  const expressionModes = Array.isArray(raw?.expressionModes)
    ? raw.expressionModes.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim())
    : DEFAULT_STYLE_IDENTITY_OPTIONS.expressionModes;
  return { styleSignals, expressionModes };
}

function normalizeStyleCodeOptions(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.dimensions)) {
    return DEFAULT_STYLE_CODE_OPTIONS;
  }
  const dimensions = raw.dimensions
    .filter((d) => d && typeof d.id === "string" && d.id.trim() && typeof d.labelLeft === "string" && typeof d.labelRight === "string")
    .map((d) => ({
      id: String(d.id).trim(),
      labelLeft: String(d.labelLeft).trim(),
      labelRight: String(d.labelRight).trim(),
    }))
    .slice(0, 10);
  return dimensions.length >= 1 ? { dimensions } : DEFAULT_STYLE_CODE_OPTIONS;
}

/**
 * Get style report settings. Returns defaults if no row exists.
 * @returns {Promise<{ minLooks: number, maxLooks: number, agentObjective?: string | null, cardConfig?: { cardOrder: string[], enabledCardTypes: string[] } }>}
 */
export async function getStyleReportSettings() {
  const prisma = getPrisma();
  try {
    const row = await prisma.styleReportSettings.findUnique({
      where: { id: ID },
    });
    if (row) {
      const cardConfig = row.cardConfig && typeof row.cardConfig === "object"
        ? normalizeCardConfig(row.cardConfig)
        : DEFAULT_CARD_CONFIG;
      const styleIdentityOptions = row.styleIdentityOptions && typeof row.styleIdentityOptions === "object"
        ? normalizeStyleIdentityOptions(row.styleIdentityOptions)
        : DEFAULT_STYLE_IDENTITY_OPTIONS;
      const styleCodeOptions = row.styleCodeOptions && typeof row.styleCodeOptions === "object"
        ? normalizeStyleCodeOptions(row.styleCodeOptions)
        : DEFAULT_STYLE_CODE_OPTIONS;
      return {
        minLooks: Math.max(1, Math.min(50, Number(row.minLooks) ?? DEFAULT_MIN)),
        maxLooks: Math.max(1, Math.min(50, Number(row.maxLooks) ?? DEFAULT_MAX)),
        agentObjective: row.agentObjective != null && String(row.agentObjective).trim() !== "" ? row.agentObjective : DEFAULT_AGENT_OBJECTIVE,
        agentTone: row.agentTone != null && String(row.agentTone).trim() !== "" ? row.agentTone : DEFAULT_AGENT_TONE,
        cardConfig,
        styleIdentityOptions,
        styleCodeOptions,
      };
    }
  } catch (_) {
    // Table may not exist yet
  }
  return {
    minLooks: DEFAULT_MIN,
    maxLooks: DEFAULT_MAX,
    agentObjective: DEFAULT_AGENT_OBJECTIVE,
    agentTone: DEFAULT_AGENT_TONE,
    cardConfig: DEFAULT_CARD_CONFIG,
    styleIdentityOptions: DEFAULT_STYLE_IDENTITY_OPTIONS,
    styleCodeOptions: DEFAULT_STYLE_CODE_OPTIONS,
  };
}

/** Legacy: treat "silhouette" as "look_recipe" so admin and report use Look recipe card. */
function normalizeCardTypeId(id) {
  return id === "silhouette" ? "look_recipe" : id;
}

function normalizeCardConfig(raw) {
  const rawOrder = Array.isArray(raw.cardOrder) ? raw.cardOrder.filter((id) => typeof id === "string") : DEFAULT_CARD_ORDER;
  const cardOrder = rawOrder.map(normalizeCardTypeId);
  const orderDeduped = [...new Set(cardOrder)];
  const rawEnabled = Array.isArray(raw.enabledCardTypes)
    ? raw.enabledCardTypes.filter((id) => typeof id === "string")
    : [...orderDeduped];
  const enabledNormalized = rawEnabled.map(normalizeCardTypeId);
  const enabledSet = new Set(enabledNormalized);
  return {
    cardOrder: orderDeduped.length ? orderDeduped : DEFAULT_CARD_ORDER,
    enabledCardTypes: orderDeduped.filter((id) => enabledSet.has(id)),
  };
}

/**
 * Update style report settings. Validates 1 <= minLooks <= maxLooks <= 50.
 * @param {{ minLooks?: number, maxLooks?: number, agentObjective?: string | null, cardConfig?: { cardOrder?: string[], enabledCardTypes?: string[] } }} payload
 * @returns {Promise<{ minLooks: number, maxLooks: number, agentObjective: string | null, cardConfig: object }>}
 */
export async function saveStyleReportSettings(payload = {}) {
  const prisma = getPrisma();
  let minLooks = payload.minLooks != null ? Number(payload.minLooks) : undefined;
  let maxLooks = payload.maxLooks != null ? Number(payload.maxLooks) : undefined;
  const agentObjective =
    payload.agentObjective !== undefined
      ? (payload.agentObjective == null || payload.agentObjective === "" ? null : String(payload.agentObjective).trim())
      : undefined;
  const agentTone =
    payload.agentTone !== undefined
      ? (payload.agentTone == null || payload.agentTone === "" ? null : String(payload.agentTone).trim())
      : undefined;
  const cardConfigPayload = payload.cardConfig;
  const styleIdentityOptionsPayload = payload.styleIdentityOptions;
  const styleCodeOptionsPayload = payload.styleCodeOptions;

  const current = await getStyleReportSettings();
  if (minLooks == null) minLooks = current.minLooks;
  if (maxLooks == null) maxLooks = current.maxLooks;

  minLooks = Math.max(1, Math.min(50, Math.floor(minLooks)));
  maxLooks = Math.max(1, Math.min(50, Math.floor(maxLooks)));
  if (minLooks > maxLooks) maxLooks = minLooks;

  const cardConfig = cardConfigPayload !== undefined && cardConfigPayload !== null
    ? normalizeCardConfig(cardConfigPayload)
    : current.cardConfig;
  const styleIdentityOptions = styleIdentityOptionsPayload !== undefined && styleIdentityOptionsPayload !== null
    ? normalizeStyleIdentityOptions(styleIdentityOptionsPayload)
    : current.styleIdentityOptions;
  const styleCodeOptions = styleCodeOptionsPayload !== undefined && styleCodeOptionsPayload !== null
    ? normalizeStyleCodeOptions(styleCodeOptionsPayload)
    : current.styleCodeOptions;

  await prisma.styleReportSettings.upsert({
    where: { id: ID },
    create: {
      id: ID,
      minLooks,
      maxLooks,
      agentObjective: agentObjective ?? null,
      agentTone: agentTone ?? null,
      cardConfig,
      styleIdentityOptions,
      styleCodeOptions,
    },
    update: {
      minLooks,
      maxLooks,
      ...(agentObjective !== undefined && { agentObjective: agentObjective ?? null }),
      ...(agentTone !== undefined && { agentTone: agentTone ?? null }),
      ...(cardConfigPayload !== undefined && cardConfigPayload !== null && { cardConfig }),
      ...(styleIdentityOptionsPayload !== undefined && styleIdentityOptionsPayload !== null && { styleIdentityOptions }),
      ...(styleCodeOptionsPayload !== undefined && styleCodeOptionsPayload !== null && { styleCodeOptions }),
    },
  });

  return getStyleReportSettings();
}
