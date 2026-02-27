/**
 * Crop image by normalized bounding box (0-1). Used for wardrobe extraction: crop → catalog → flat lay.
 */

import sharp from "sharp";

/**
 * Normalized bbox: x, y, w, h in [0, 1] (relative to image dimensions).
 * @typedef {{ x: number, y: number, w: number, h: number }} NormalizedBbox
 */

/**
 * Crop image buffer by normalized bounding box.
 * @param {Buffer} imageBuffer - Raw image (jpeg, png, webp, etc.)
 * @param {NormalizedBbox} bbox - { x, y, w, h } in 0-1 range
 * @param {{ format?: string, quality?: number }} options - format: jpeg|png|webp; quality for jpeg/webp
 * @returns {Promise<Buffer>} Cropped image buffer
 */
export async function cropByBbox(imageBuffer, bbox, options = {}) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new Error("imageBuffer is required");
  }
  const { x = 0, y = 0, w = 1, h = 1 } = bbox;
  const xNorm = Math.max(0, Math.min(1, Number(x)));
  const yNorm = Math.max(0, Math.min(1, Number(y)));
  const wNorm = Math.max(0.01, Math.min(1, Number(w)));
  const hNorm = Math.max(0.01, Math.min(1, Number(h)));

  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width || 1;
  const height = meta.height || 1;

  const left = Math.floor(xNorm * width);
  const top = Math.floor(yNorm * height);
  const cropW = Math.max(1, Math.min(width - left, Math.ceil(wNorm * width)));
  const cropH = Math.max(1, Math.min(height - top, Math.ceil(hNorm * height)));

  const format = options.format || "jpeg";
  let pipeline = sharp(imageBuffer).extract({ left, top, width: cropW, height: cropH });

  if (format === "jpeg") {
    pipeline = pipeline.jpeg({ quality: options.quality ?? 90 });
  } else if (format === "webp") {
    pipeline = pipeline.webp({ quality: options.quality ?? 90 });
  } else if (format === "png") {
    pipeline = pipeline.png();
  }

  return pipeline.toBuffer();
}

/**
 * Convert bbox from x_min,y_min,x_max,y_max (normalized 0-1) to x,y,w,h.
 * @param {object} b - bbox with x_min, y_min, x_max, y_max
 * @returns {NormalizedBbox | null}
 */
function bboxFromMinMax(b) {
  const xMin = Number(b.x_min ?? b.xMin ?? NaN);
  const yMin = Number(b.y_min ?? b.yMin ?? NaN);
  const xMax = Number(b.x_max ?? b.xMax ?? NaN);
  const yMax = Number(b.y_max ?? b.yMax ?? NaN);
  if (Number.isNaN(xMin) || Number.isNaN(yMin) || Number.isNaN(xMax) || Number.isNaN(yMax)) return null;
  const x = Math.max(0, Math.min(1, xMin));
  const y = Math.max(0, Math.min(1, yMin));
  const w = Math.max(0.01, Math.min(1, xMax - xMin));
  const h = Math.max(0.01, Math.min(1, yMax - yMin));
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

/**
 * Check if an item has a valid normalized bbox we can use for cropping.
 * Accepts { x, y, w, h } or { x, y, width, height } or { x_min, y_min, x_max, y_max }.
 * @param {object} item - Vision item: { bbox?: { ... } }
 * @returns {boolean}
 */
export function hasValidBbox(item) {
  const norm = getNormalizedBbox(item);
  return norm !== null;
}

/**
 * Get normalized bbox from vision item.
 * Handles: x,y,w,h | x,y,width,height | x_min,y_min,x_max,y_max (or camelCase).
 * @param {object} item - Vision item with bbox
 * @returns {NormalizedBbox | null}
 */
export function getNormalizedBbox(item) {
  const b = item?.bbox;
  if (!b || typeof b !== "object") return null;

  const xMin = b.x_min ?? b.xMin;
  const yMin = b.y_min ?? b.yMin;
  const xMax = b.x_max ?? b.xMax;
  const yMax = b.y_max ?? b.yMax;
  const hasMinMax =
    (xMin !== undefined && xMin !== null && !Number.isNaN(Number(xMin))) &&
    (yMin !== undefined && yMin !== null && !Number.isNaN(Number(yMin))) &&
    (xMax !== undefined && xMax !== null && !Number.isNaN(Number(xMax))) &&
    (yMax !== undefined && yMax !== null && !Number.isNaN(Number(yMax)));

  if (hasMinMax) {
    const fromMinMax = bboxFromMinMax(b);
    if (fromMinMax) return fromMinMax;
  }

  const x = Number(b.x);
  const y = Number(b.y);
  const w = Number(b.w ?? b.width ?? 0);
  const h = Number(b.h ?? b.height ?? 0);
  if (Number.isNaN(x) || Number.isNaN(y) || w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}
