/**
 * Input fingerprint for style report cache: same inputs + same code => same fingerprint => return cached report.
 * Fingerprint = lookFingerprint + '|' + settingsFingerprint + '|' + codeVersion.
 * Bump STYLE_REPORT_AGENT_VERSION when you change agent logic, prompts, or card generators so cached reports are invalidated.
 */
export const STYLE_REPORT_AGENT_VERSION = "1";

import { createHash } from "crypto";

/**
 * Build deterministic fingerprint from the exact set of looks used for the report.
 * Uses look id + updatedAt so any new look or edit invalidates cache.
 * @param {Array<{ id: string, updatedAt?: Date | string, lookData?: string | object }>} looks - Same order as listLooksForStyleReport
 * @returns {string}
 */
export function buildLookFingerprint(looks) {
  if (!Array.isArray(looks) || looks.length === 0) return "";
  const parts = looks.map((l) => {
    const id = l?.id ?? "";
    const updated = l?.updatedAt != null ? new Date(l.updatedAt).toISOString() : "";
    const data = l?.lookData != null ? (typeof l.lookData === "string" ? l.lookData : JSON.stringify(l.lookData)) : "";
    const dataHash = data ? createHash("sha256").update(data).digest("hex").slice(0, 16) : "";
    return `${id}:${updated}:${dataHash}`;
  });
  return createHash("sha256").update(parts.join(";")).digest("hex");
}

/**
 * Build deterministic fingerprint from style report settings that affect output.
 * @param {object} settings - From getStyleReportSettings(): minLooks, maxLooks, agentObjective, agentTone, cardConfig, styleIdentityOptions, styleCodeOptions
 * @returns {string}
 */
export function buildSettingsFingerprint(settings) {
  if (!settings || typeof settings !== "object") return "";
  const normalized = {
    minLooks: Number(settings.minLooks) ?? 7,
    maxLooks: Number(settings.maxLooks) ?? 15,
    agentObjective: settings.agentObjective != null ? String(settings.agentObjective).trim() : "",
    agentTone: settings.agentTone != null ? String(settings.agentTone).trim() : "",
    cardOrder: Array.isArray(settings.cardConfig?.cardOrder) ? settings.cardConfig.cardOrder.slice().sort() : [],
    enabledCardTypes: Array.isArray(settings.cardConfig?.enabledCardTypes)
      ? settings.cardConfig.enabledCardTypes.slice().sort()
      : [],
    styleSignals: Array.isArray(settings.styleIdentityOptions?.styleSignals)
      ? settings.styleIdentityOptions.styleSignals.slice().sort()
      : [],
    expressionModes: Array.isArray(settings.styleIdentityOptions?.expressionModes)
      ? settings.styleIdentityOptions.expressionModes.slice().sort()
      : [],
    styleCodeDimensions: Array.isArray(settings.styleCodeOptions?.dimensions)
      ? settings.styleCodeOptions.dimensions.map((d) => `${d.id}:${d.labelLeft}:${d.labelRight}`).sort()
      : [],
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

/**
 * Full cache key: lookFingerprint | settingsFingerprint | codeVersion.
 * When codeVersion changes (bump STYLE_REPORT_AGENT_VERSION), all existing cached reports are invalidated.
 * @param {string} lookFp
 * @param {string} settingsFp
 * @param {string} [codeVersion] - Defaults to STYLE_REPORT_AGENT_VERSION
 * @returns {string}
 */
export function buildStyleReportInputFingerprint(lookFp, settingsFp, codeVersion = STYLE_REPORT_AGENT_VERSION) {
  return `${lookFp}|${settingsFp}|${codeVersion}`;
}
