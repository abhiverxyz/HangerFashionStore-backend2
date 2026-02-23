/**
 * Shared "user context from profile" for agents that call Look Composition or need vibe/occasion/categories.
 * Used by Look Planning Agent and Styling Agent so both use the same shape.
 * D.5.1: Includes fashionNeed and fashionMotivation for Concierge personalization.
 *
 * @param {Object} profile - Result of getUserProfile (may have styleProfile.data, fashionNeed, fashionMotivation).
 * @returns {{ preferredVibe?: string, preferredOccasion?: string, preferredCategoryLvl1?: string[], fashionNeed?: string, fashionMotivation?: string } | undefined}
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
  const fashionNeed = profile.fashionNeed?.text && String(profile.fashionNeed.text).trim() ? String(profile.fashionNeed.text).trim() : undefined;
  const fashionMotivation = profile.fashionMotivation?.text && String(profile.fashionMotivation.text).trim() ? String(profile.fashionMotivation.text).trim() : undefined;
  const out = {};
  if (preferredVibe) out.preferredVibe = preferredVibe;
  if (preferredOccasion) out.preferredOccasion = preferredOccasion;
  if (preferredCategoryLvl1?.length) out.preferredCategoryLvl1 = preferredCategoryLvl1;
  if (fashionNeed) out.fashionNeed = fashionNeed;
  if (fashionMotivation) out.fashionMotivation = fashionMotivation;
  return Object.keys(out).length ? out : undefined;
}
