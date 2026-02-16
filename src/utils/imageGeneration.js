/**
 * Image generation utility — B0.2
 * Single interface for agents: generateImage(prompt, options?) → { imageUrl }.
 * Wraps Phase 3 domain (Replicate Flux → storage). Used by Styling Agent, Look Composition, MicroStore Curation.
 */

import { generateAndStoreImage } from "../domain/images/generate.js";

/**
 * Generate an image from a text prompt and store it; return the URL.
 * @param {string} prompt - Text prompt for image generation
 * @param {object} options - { aspectRatio? } (e.g. "3:4" for fashion)
 * @returns {Promise<{ imageUrl: string, key?: string }>}
 */
export async function generateImage(prompt, options = {}) {
  const result = await generateAndStoreImage(prompt, options);
  return { imageUrl: result.imageUrl, key: result.key };
}
