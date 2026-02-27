/**
 * Vision analysis for Live Styling Session.
 * Returns signals shape: personDetected, outfitDetected, garments[], palette[], vibe[], occasionGuess[], notes[].
 * Uses imageAnalysis with a custom prompt; normalizes or stubs on failure.
 */

import { analyzeImage } from "./imageAnalysis.js";

const SESSION_VISION_PROMPT = `Analyze this photo from a live styling session (person in frame, possibly showing outfit).

Return a single JSON object with exactly these keys:
- "personDetected": boolean (true if a person is clearly visible)
- "outfitDetected": boolean (true if clothing/outfit is visible)
- "garments": array of objects, each with: "type" (e.g. "top", "bottom", "outerwear", "footwear", "accessory"), "label" (e.g. "blazer", "tank", "jeans"), "color" (string)
- "palette": array of color names (e.g. ["black", "white", "blue"])
- "vibe": array of short style vibes (e.g. ["minimal", "structured"])
- "occasionGuess": array of possible occasions (e.g. ["casual dinner", "smart casual"])
- "notes": array of short observation strings (e.g. ["strong contrast", "clean lines"])

If no person or outfit is clearly visible, set personDetected and/or outfitDetected to false and use empty arrays where needed.`;

/**
 * Run vision analysis on a single image for the styling session.
 * @param {string|Buffer} imageUrlOrBuffer - Image URL or buffer
 * @returns {Promise<{ personDetected: boolean, outfitDetected: boolean, garments: array, palette: array, vibe: array, occasionGuess: array, notes: array }>}
 */
export async function analyzeSessionFrame(imageUrlOrBuffer) {
  try {
    const raw = await analyzeImage(imageUrlOrBuffer, {
      prompt: SESSION_VISION_PROMPT,
      responseFormat: "json_object",
      maxTokens: 800,
    });

    return {
      personDetected: raw?.personDetected === true,
      outfitDetected: raw?.outfitDetected === true,
      garments: Array.isArray(raw?.garments)
        ? raw.garments.map((g) => ({
            type: g?.type || "clothing",
            label: g?.label || "",
            color: g?.color || "",
          }))
        : [],
      palette: Array.isArray(raw?.palette) ? raw.palette.map((p) => String(p).trim()).filter(Boolean) : [],
      vibe: Array.isArray(raw?.vibe) ? raw.vibe.map((v) => String(v).trim()).filter(Boolean) : [],
      occasionGuess: Array.isArray(raw?.occasionGuess) ? raw.occasionGuess.map((o) => String(o).trim()).filter(Boolean) : [],
      notes: Array.isArray(raw?.notes) ? raw.notes.map((n) => String(n).trim()).filter(Boolean) : [],
    };
  } catch (e) {
    console.warn("[sessionVisionAnalysis] analyzeSessionFrame failed:", e?.message);
    return {
      personDetected: false,
      outfitDetected: false,
      garments: [],
      palette: [],
      vibe: [],
      occasionGuess: [],
      notes: ["Image could not be analyzed. Try better lighting or hold the camera steady."],
    };
  }
}

/**
 * Analyze the best of multiple frames (e.g. first image, or merge results).
 * @param {Array<string|Buffer>} images - Array of image URLs or buffers
 * @returns {Promise<object>} Same signals shape as analyzeSessionFrame
 */
export async function analyzeSessionFrames(images) {
  if (!Array.isArray(images) || images.length === 0) {
    return {
      personDetected: false,
      outfitDetected: false,
      garments: [],
      palette: [],
      vibe: [],
      occasionGuess: [],
      notes: [],
    };
  }
  const first = images[0];
  return analyzeSessionFrame(first);
}
