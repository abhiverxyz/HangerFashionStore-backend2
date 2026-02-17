/**
 * Shared "user context from profile" for agents that call Look Composition or need vibe/occasion/categories.
 * Used by Look Planning Agent and Styling Agent so both use the same shape (preferredVibe, preferredOccasion, preferredCategoryLvl1).
 *
 * @param {Object} profile - Result of getUserProfile (may have styleProfile.data).
 * @returns {{ preferredVibe?: string, preferredOccasion?: string, preferredCategoryLvl1?: string[] } | undefined}
 */
export function buildUserContextFromProfile(profile) {
  if (!profile) return undefined;
  const data = profile.styleProfile?.data;
  const preferredVibe =
    (data && typeof data === "object" && data.vibe) ||
    (typeof data === "string" && data.trim()) ||
    null;
  const preferredOccasion = (data && typeof data === "object" && data.occasion) || null;
  const preferredCategoryLvl1 = Array.isArray(data?.preferredCategoryLvl1)
    ? data.preferredCategoryLvl1
    : data && data.category_lvl1
      ? [data.category_lvl1]
      : undefined;
  const out = {};
  if (preferredVibe) out.preferredVibe = preferredVibe;
  if (preferredOccasion) out.preferredOccasion = preferredOccasion;
  if (preferredCategoryLvl1?.length) out.preferredCategoryLvl1 = preferredCategoryLvl1;
  return Object.keys(out).length ? out : undefined;
}
