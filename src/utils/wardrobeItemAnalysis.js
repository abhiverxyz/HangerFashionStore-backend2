/**
 * @deprecated Use wardrobeAgent.analyzeItem() instead. This module is a thin wrapper for backward compatibility.
 */
import { analyzeItem } from "../agents/wardrobeAgent.js";

/**
 * Analyze a single wardrobe item image and return category, color, and description for storage.
 * @param {string|Buffer} imageUrlOrBuffer - Image as URL (will be resolved if our storage) or buffer
 * @returns {Promise<{ category: string | null, color: string | null, tags: string | null }>}
 */
export async function analyzeWardrobeItemImage(imageUrlOrBuffer) {
  const result = await analyzeItem(imageUrlOrBuffer);
  return {
    category: result.category ?? null,
    color: result.color ?? null,
    tags: result.tags ?? null,
  };
}
