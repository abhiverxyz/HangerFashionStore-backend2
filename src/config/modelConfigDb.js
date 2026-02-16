/**
 * DB read/write for ModelConfig. Used by modelConfig.js and admin routes.
 */

import { getPrisma } from "../core/db.js";

/**
 * Load model config for one scope from DB.
 * @param {string} scope
 * @returns {Promise<{ provider: string, model: string } | null>}
 */
export async function loadFromDb(scope) {
  const prisma = getPrisma();
  const row = await prisma.modelConfig.findUnique({
    where: { scope },
    select: { provider: true, model: true },
  });
  return row ? { provider: row.provider, model: row.model } : null;
}

/**
 * Upsert model config for one scope. Call invalidateModelConfigCache(scope) after this.
 * @param {string} scope
 * @param {{ provider: string, model: string }} config
 */
export async function saveModelConfig(scope, { provider, model }) {
  const prisma = getPrisma();
  await prisma.modelConfig.upsert({
    where: { scope },
    create: { scope, provider: String(provider).trim(), model: String(model).trim() },
    update: { provider: String(provider).trim(), model: String(model).trim() },
  });
}
