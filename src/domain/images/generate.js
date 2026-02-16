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
    if (!token) throw new Error("REPLICATE_API_TOKEN is required for image generation");
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
  if (!config) throw new Error("No model config for scope imageGeneration");
  if (config.provider !== "flux") {
    throw new Error(`Image generation only supports provider=flux; got ${config.provider}`);
  }

  const replicate = await getReplicateClient();
  console.log("[Generate] Flux generating:", prompt.substring(0, 80) + "...");

  const output = await replicate.run(config.model, {
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

  const rawImageUrl = Array.isArray(output) ? output[0] : output;
  if (!rawImageUrl || typeof rawImageUrl !== "string") {
    throw new Error("No image URL from Flux");
  }

  const response = await axios.get(rawImageUrl, {
    responseType: "arraybuffer",
    timeout: 30_000,
  });
  const buffer = Buffer.from(response.data);
  const key = `generated/${randomUUID()}.webp`;
  const { url, key: storedKey } = await uploadFile(buffer, key, "image/webp", { requireRemote: true });

  return { imageUrl: url, key: storedKey };
}
