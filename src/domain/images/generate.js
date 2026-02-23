/**
 * Generate image from prompt (Replicate Flux), upload to storage, return URL.
 * No agent logic here; used by Phase 4 agents. Provider/model from central config.
 */

import { randomUUID } from "crypto";
import axios from "axios";
import { getModelConfig } from "../../config/modelConfig.js";
import { uploadFile } from "../../utils/storage.js";

const MAX_PROMPT_LENGTH = 2000;

let replicateClient = null;

async function getReplicateClient() {
  if (!replicateClient) {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      console.error("[Generate] REPLICATE_API_TOKEN is not set — add it to backend .env for image generation");
      throw new Error("REPLICATE_API_TOKEN is required for image generation");
    }
    const Replicate = (await import("replicate")).default;
    replicateClient = new Replicate({ auth: token });
  }
  return replicateClient;
}

/**
 * Generate image and store it. Returns our storage URL.
 * @param {string} prompt - Text prompt for image generation
 * @param {object} options - { aspectRatio?, provider?, model? }
 * @returns {Promise<{ imageUrl: string, key: string }>}
 */
export async function generateAndStoreImage(prompt, options = {}) {
  if (!prompt || typeof prompt !== "string") throw new Error("prompt required");
  const trimmed = prompt.trim();
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    throw new Error(`prompt must be at most ${MAX_PROMPT_LENGTH} characters`);
  }

  const config = await getModelConfig("imageGeneration", {
    provider: options.provider,
    model: options.model,
  });
  if (!config) {
    console.error("[Generate] No model config for imageGeneration — check config or env IMAGE_GENERATION_PROVIDER / IMAGE_GENERATION_MODEL");
    throw new Error("No model config for scope imageGeneration");
  }
  if (config.provider !== "flux") {
    throw new Error(`Image generation only supports provider=flux; got ${config.provider}`);
  }

  const replicate = await getReplicateClient();
  console.log("[Generate] Flux generating (model:", config.model, "):", prompt.substring(0, 80) + "...");

  let output;
  try {
    output = await replicate.run(config.model, {
      input: {
        prompt: trimmed,
        go_fast: true,
        megapixels: "1",
        num_outputs: 1,
        aspect_ratio: options.aspectRatio || "3:4",
        output_format: "webp",
        output_quality: 80,
      },
    });
  } catch (err) {
    console.error("[Generate] Replicate run failed:", err?.message);
    throw err;
  }

  const first = Array.isArray(output) ? output[0] : output;
  let rawImageUrl = null;
  if (typeof first === "string") {
    rawImageUrl = first;
  } else if (first != null && typeof first === "object") {
    if (typeof first.url === "function") {
      rawImageUrl = first.url().toString();
    } else if (typeof first.toString === "function") {
      rawImageUrl = first.toString();
    } else if (first.url != null) {
      rawImageUrl = String(first.url);
    } else if (first.href != null) {
      rawImageUrl = String(first.href);
    }
  }
  if (!rawImageUrl || typeof rawImageUrl !== "string") {
    console.error("[Generate] Flux returned no image URL. Output:", typeof output, Array.isArray(output) ? output?.length : "", first != null ? typeof first : "");
    throw new Error("No image URL from Flux");
  }

  let buffer;
  try {
    const response = await axios.get(rawImageUrl, {
      responseType: "arraybuffer",
      timeout: 30_000,
    });
    buffer = Buffer.from(response.data);
  } catch (err) {
    console.error("[Generate] Failed to fetch image from Replicate URL:", err?.message);
    throw err;
  }

  const key = `generated/${randomUUID()}.webp`;
  try {
    const { url, key: storedKey } = await uploadFile(buffer, key, "image/webp", { requireRemote: true });
    console.log("[Generate] Image uploaded to storage OK");
    return { imageUrl: url, key: storedKey };
  } catch (err) {
    console.error("[Generate] Upload to R2 failed:", err?.message);
    throw err;
  }
}
