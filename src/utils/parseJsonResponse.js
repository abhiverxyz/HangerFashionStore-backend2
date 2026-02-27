/**
 * Shared helper: strip optional markdown code fence and parse JSON from LLM/vision response text.
 * Tolerates truncated or slightly malformed JSON from vision/LLM.
 */

/**
 * @param {string} text - Raw response (may be wrapped in ```json ... ```)
 * @returns {object} Parsed JSON
 */
export function parseJsonResponse(text) {
  if (!text || typeof text !== "string") throw new Error("parseJsonResponse: text required");
  const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    if (e instanceof SyntaxError) {
      const repaired = tryRepairTruncatedJson(cleaned, e);
      if (repaired !== null) return repaired;
    }
    throw e;
  }
}

/**
 * Extract position from SyntaxError message (e.g. "Unterminated string at position 2996").
 * @param {SyntaxError} e
 * @returns {number | null}
 */
function getParsePosition(e) {
  const m = /position\s+(\d+)/i.exec(e.message);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Attempt to repair truncated JSON. Handles truncated objects and unterminated strings.
 * @param {string} raw
 * @param {SyntaxError} [syntaxError] - optional, for position-based repair
 * @returns {object|null} Parsed object or null if repair failed
 */
function tryRepairTruncatedJson(raw, syntaxError) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  const candidates = [
    trimmed + "}",
    trimmed.replace(/,(\s*)[}\]"]*$/, "$1}"),
  ];
  for (let i = trimmed.length - 1; i > 10; i--) {
    if (trimmed[i] === "}") candidates.push(trimmed.slice(0, i + 1));
  }
  const pos = syntaxError ? getParsePosition(syntaxError) : null;
  if (pos != null && pos > 0 && pos < trimmed.length) {
    let cut = trimmed.slice(0, pos);
    const openBraces = (cut.match(/\{/g) || []).length - (cut.match(/\}/g) || []).length;
    const openBrackets = (cut.match(/\[/g) || []).length - (cut.match(/\]/g) || []).length;
    if (!/[,:\[\{}\s]$/.test(cut.replace(/\s+$/, ""))) cut += '"';
    for (let b = 0; b < openBrackets; b++) cut += "]";
    for (let b = 0; b < openBraces; b++) cut += "}";
    candidates.push(cut);
  }
  const openBraces = (trimmed.match(/\{/g) || []).length - (trimmed.match(/\}/g) || []).length;
  const openBrackets = (trimmed.match(/\[/g) || []).length - (trimmed.match(/\]/g) || []).length;
  let suffix = "";
  if (!trimmed.endsWith('"') && !/[,}\]]\s*$/.test(trimmed)) suffix = '"';
  for (let b = 0; b <= openBrackets; b++) suffix += "]";
  for (let b = 0; b <= openBraces; b++) suffix += "}";
  candidates.push(trimmed + suffix);
  for (const s of candidates) {
    try {
      const parsed = JSON.parse(s);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      continue;
    }
  }
  return null;
}
