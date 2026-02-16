/**
 * Pure helpers – no I/O. Safe to import from any layer.
 */

export function safeJsonParse(str, fallback = null) {
  if (str == null || typeof str !== "string") return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

export function normalizeId(id) {
  if (id == null) return null;
  const s = String(id).trim();
  return s === "" ? null : s;
}

export function slugify(text) {
  if (text == null || typeof text !== "string") return "";
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}
