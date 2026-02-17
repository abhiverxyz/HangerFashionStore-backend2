/**
 * B0 utilities smoke test.
 * Run from backend2: npm run test:b0  (or test:b0:all to include image generation)
 *
 * Requires .env: OPENAI_API_KEY for LLM/embed/vision; optional R2 or local storage;
 * with --with-generate: REPLICATE_API_TOKEN and storage for image generation.
 */

import { complete, embedText } from "../src/utils/llm.js";
import { uploadFile } from "../src/utils/storage.js";
import { analyzeImage } from "../src/utils/imageAnalysis.js";

const withGenerate = process.argv.includes("--with-generate");

async function testEmbed() {
  console.log("  embedText…");
  const vec = await embedText("test sentence for embedding");
  if (!Array.isArray(vec) || vec.length < 100) throw new Error("Expected non-empty vector");
  console.log("  embedText OK (dim=%d)", vec.length);
}

async function testComplete() {
  console.log("  complete…");
  const reply = await complete([{ role: "user", content: "Reply with only the word OK." }], { maxTokens: 10 });
  if (typeof reply !== "string" || !reply.trim()) throw new Error("Expected string reply");
  console.log("  complete OK");
}

async function testStorage() {
  console.log("  uploadFile…");
  const key = `b0-test/${Date.now()}.txt`;
  const { url, key: k, size } = await uploadFile(Buffer.from("B0 test\n"), key, "text/plain");
  if (!url || !k || size !== 8) throw new Error("Expected url, key, size");
  console.log("  uploadFile OK (url=%s)", url.slice(0, 50));
}

async function testImageAnalysis() {
  const testUrl = process.env.TEST_IMAGE_URL;
  if (!testUrl) {
    console.log("  analyzeImage… skip (set TEST_IMAGE_URL to test vision)");
    return;
  }
  console.log("  analyzeImage…");
  const result = await analyzeImage(testUrl, { responseFormat: "json_object", maxTokens: 500 });
  if (!result || (result.items === undefined && result.look === undefined)) {
    throw new Error("Expected { items } or { look } from vision");
  }
  console.log("  analyzeImage OK");
}

async function testImageGeneration() {
  console.log("  generateImage…");
  const { generateImage } = await import("../src/utils/imageGeneration.js");
  const { imageUrl } = await generateImage("a single red apple on white background", { aspectRatio: "1:1" });
  if (!imageUrl || typeof imageUrl !== "string") throw new Error("Expected imageUrl");
  console.log("  generateImage OK");
}

async function main() {
  console.log("B0 utilities test (withGenerate=%s)\n", withGenerate);

  let failed = 0;

  try {
    await testEmbed();
  } catch (e) {
    console.error("  embedText FAIL:", e.message);
    failed++;
  }
  try {
    await testComplete();
  } catch (e) {
    console.error("  complete FAIL:", e.message);
    failed++;
  }
  try {
    await testStorage();
  } catch (e) {
    console.error("  uploadFile FAIL:", e.message);
    failed++;
  }
  try {
    await testImageAnalysis();
  } catch (e) {
    console.error("  analyzeImage FAIL:", e.message);
    failed++;
  }

  if (withGenerate) {
    try {
      await testImageGeneration();
    } catch (e) {
      console.error("  generateImage FAIL:", e.message);
      failed++;
    }
  } else {
    console.log("  (skip generateImage; use npm run test:b0:all to include)");
  }

  console.log("");
  if (failed > 0) {
    console.error("%d test(s) failed.", failed);
    process.exit(1);
  }
  console.log("All B0 utility tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
