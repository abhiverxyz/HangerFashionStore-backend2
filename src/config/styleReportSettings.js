/**
 * Style report agent settings: min/max number of looks. Agent always uses latest looks in [minLooks, maxLooks].
 */

import { getPrisma } from "../core/db.js";

const DEFAULT_MIN = 1;
const DEFAULT_MAX = 15;
const ID = "default";

/**
 * Get style report settings. Returns defaults if no row exists.
 * @returns {Promise<{ minLooks: number, maxLooks: number }>}
 */
export async function getStyleReportSettings() {
  const prisma = getPrisma();
  try {
    const row = await prisma.styleReportSettings.findUnique({
      where: { id: ID },
    });
    if (row) {
      return {
        minLooks: Math.max(1, Math.min(50, Number(row.minLooks) || DEFAULT_MIN)),
        maxLooks: Math.max(1, Math.min(50, Number(row.maxLooks) || DEFAULT_MAX)),
      };
    }
  } catch (_) {
    // Table may not exist yet
  }
  return { minLooks: DEFAULT_MIN, maxLooks: DEFAULT_MAX };
}

/**
 * Update style report settings. Validates 1 <= minLooks <= maxLooks <= 50.
 * @param {{ minLooks?: number, maxLooks?: number }} payload
 * @returns {Promise<{ minLooks: number, maxLooks: number }>}
 */
export async function saveStyleReportSettings(payload = {}) {
  const prisma = getPrisma();
  let minLooks = payload.minLooks != null ? Number(payload.minLooks) : undefined;
  let maxLooks = payload.maxLooks != null ? Number(payload.maxLooks) : undefined;

  const current = await getStyleReportSettings();
  if (minLooks == null) minLooks = current.minLooks;
  if (maxLooks == null) maxLooks = current.maxLooks;

  minLooks = Math.max(1, Math.min(50, Math.floor(minLooks)));
  maxLooks = Math.max(1, Math.min(50, Math.floor(maxLooks)));
  if (minLooks > maxLooks) maxLooks = minLooks;

  await prisma.styleReportSettings.upsert({
    where: { id: ID },
    create: { id: ID, minLooks, maxLooks },
    update: { minLooks, maxLooks },
  });

  return { minLooks, maxLooks };
}
